"""
This module contains the StretchIKControl class, which allows users to compute Stretch's FK and IK,
command the robot using an inverse Jacobian velocity controller, and command the arm to a desired pose.

Parts of this approach are inspired from:
https://github.com/RCHI-Lab/HAT2/blob/main/driver_assistance/da_core/scripts/stretch_ik_solver.py
"""
# Standard Imports
import threading
import traceback
from enum import Enum
from typing import Callable, Dict, Generator, List, Optional, Tuple, Union

# Third-Party Imports
import numpy as np
import numpy.typing as npt
import pinocchio
import rclpy
import tf2_ros
from action_msgs.msg import GoalStatus
from builtin_interfaces.msg import Time
from control_msgs.action import FollowJointTrajectory
from geometry_msgs.msg import Transform, Twist, Vector3
from rclpy.action import ActionClient
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup
from rclpy.duration import Duration
from rclpy.node import Node
from rclpy.task import Future
from sensor_msgs.msg import JointState
from std_srvs.srv import Trigger
from stretch_body.robot_params import RobotParams
from tf2_geometry_msgs import PoseStamped, TransformStamped
from tf_transformations import (
    euler_from_quaternion,
    quaternion_inverse,
    quaternion_matrix,
    quaternion_multiply,
)
from trajectory_msgs.msg import JointTrajectoryPoint

# Local Imports
from .constants import ControlMode, Frame, Joint, SpeedProfile
from .conversions import (
    create_ros_pose,
    get_pos_quat_from_ros,
    remaining_time,
    tf2_transform,
)
from .pinocchio_ik_solver import PinocchioIKSolver, PositionIKOptimizer


class TerminationCriteria(Enum):
    """
    The termination criteria for the inverse Jacobian controller.
    """

    # Terminate when the commanded velocity is (near) zero.
    ZERO_VEL = "zero_vel"
    # Terminate when the error between the end-effector pose and the goal pose is (near) zero.
    # NOTE: This will not converge if the goal pose is unreachable.
    ZERO_ERR = "zero_err"


class MotionGeneratorRetval(Enum):
    """
    The return values for the motion generators.
    """

    CONTINUE = 0
    SUCCESS = 1
    FAILURE = 2


class StretchIKControl:
    """
    The StretchIKControl class allows users to compute Stretch's FK and IK, command the robot using an inverse
    Jacobian velocity controller, and command the arm to a desired joint configuration.
    """

    def __init__(
        self,
        node: Node,
        tf_buffer: tf2_ros.Buffer,
        urdf_path: str,
        static_transform_broadcaster: tf2_ros.StaticTransformBroadcaster,
        speed_profile: SpeedProfile = SpeedProfile.MAX,  # TODO: consider allowing users to set this in the message!
        use_ik_optimizer: bool = False,
    ):
        """
        Create the StretchIKControl object.

        Parameters:
        ----------
        node: The ROS2 node that will run the controller.
        tf_buffer: The tf2 buffer to use to transform poses.
        urdf_path: The path to the URDF file for the robot.
        static_transform_broadcaster: The static transform broadcaster to use to publish the end effector pose.
        speed_profile: The speed profile to use to get max velocities and accelerations.
        use_ik_optimizer: Whether to use the PositionIKOptimizer to compute the IK solution.
        """
        # Store the parameters
        self.node = node
        self.tf_buffer = tf_buffer
        self.urdf_path = urdf_path
        self.static_transform_broadcaster = static_transform_broadcaster
        self.speed_profile = speed_profile
        self.use_ik_optimizer = use_ik_optimizer
        self.initialized = False

    def initialize(self):
        """
        Initialize the StretchIKControl object.
        """
        # Load the IK solver.
        # We restrict IK to the base rotation, arm lift, and arm joints,
        # to avoid non-ideal IK solutions that either take advantage of
        # joint redundancies (e.g., base rotation and wrist yaw) or get
        # stuck in the gimbal lock that occurs when the wrist pitch is
        # -pi/2. Note that this also means we can only control the below
        # joints with inverse jacobian control.
        self.controllable_joints = [
            Joint.BASE_ROTATION,
            Joint.ARM_LIFT,
            Joint.ARM_L0,  # The URDF uses the most distal of the telescoping joints
        ]
        self.base_ik_solver = PinocchioIKSolver(
            self.urdf_path,
            Frame.END_EFFECTOR_LINK.value,
            [joint.value for joint in self.controllable_joints],
        )
        if self.use_ik_optimizer:
            # In practice, I've found that this doesn't work at times when
            # the base IK solver does. Perhaps it requires tuning.
            self.ik_solver = PositionIKOptimizer(
                ik_solver=self.base_ik_solver,
                pos_error_tol=0.005,
                ori_error_range=np.array([0.0, 0.0, 0.2]),
            )
        else:
            self.ik_solver = self.base_ik_solver
        self.all_joints_str = self.base_ik_solver.get_all_joint_names()
        self.all_joints = [Joint(name) for name in self.all_joints_str]
        # Store the control gains
        # NOTE: The CMU implementation had controller gains of 0.2 on the
        # telescoping arm joints and 1.0 otherwise, but for this implementation
        # 1.0 everywhere seems to work fine.
        self.K = np.eye(len(self.all_joints), dtype=float)
        base_rotation_i = self.all_joints.index(Joint.BASE_ROTATION)
        self.K[base_rotation_i, base_rotation_i] = 1.0

        # Subscribe to the robot's joint limits and state
        self.latest_joint_limits_lock = threading.Lock()
        self.latest_joint_limits = None
        self.joint_limits_sub = self.node.create_subscription(
            JointState,
            "/joint_limits",
            self.__joint_limits_cb,
            qos_profile=1,
            # callback_group=MutuallyExclusiveCallbackGroup(),
        )
        self.latest_joint_state_lock = threading.Lock()
        self.latest_joint_state = None
        self.joint_state_sub = self.node.create_subscription(
            JointState,
            "/stretch/joint_states",
            self.__joint_state_cb,
            qos_profile=1,
            callback_group=MutuallyExclusiveCallbackGroup(),
        )

        # Get the joint limits
        ok = self.__load_joint_limits(speed_profile=self.speed_profile)
        if not ok:
            return False

        # Create a service client to switch to navigation mode
        navigation_mode = ControlMode.NAVIGATION
        self.switch_to_navigation_client = self.node.create_client(
            Trigger,
            navigation_mode.get_service_name(),
            callback_group=MutuallyExclusiveCallbackGroup(),
        )

        # Create a publisher and action client to command robot motion
        self.base_vel_pub = self.node.create_publisher(
            Twist,
            "/stretch/cmd_vel",
            qos_profile=1,
        )
        self.arm_client_send_goal_future = None
        self.arm_client_get_result_future = None
        self.arm_client = ActionClient(
            self.node,
            FollowJointTrajectory,
            "/stretch_controller/follow_joint_trajectory",
            callback_group=MutuallyExclusiveCallbackGroup(),
        )

        self.initialized = True
        return True

    def __load_joint_limits(self, speed_profile: SpeedProfile) -> bool:
        """
        Loads the position and velocity limits for the robot's joints.

        Note that we load a single limit for the arm, as opposed to separate limits
        per telescoping joint. Also note that this function blocks until the service
        to get joint limits is available.

        Parameters
        ----------
        speed_profile: The speed profile to use to get max velocities and accelerations.

        Returns
        -------
        bool: True if the joint limits were successfully loaded.
        """
        # Invoke the service to get joint limits. Note that this service
        # does not actually return the joint limits. Rather, it publishes the joint
        # limits to the /joint_limits topic.
        get_joint_limits_client = self.node.create_client(
            Trigger,
            "get_joint_states",
            # callback_group=MutuallyExclusiveCallbackGroup(),
        )
        self.node.get_logger().info("Waiting for the get joint states service...")
        # NOTE: Waiting for the service can block, although we haven't noticed an issue
        # stemming from it.
        get_joint_limits_client.wait_for_service()
        response = get_joint_limits_client.call(Trigger.Request())
        if not response.success:
            self.node.get_logger().error("Failed to get joint limits.")
            return False
        self.node.get_logger().info("Received the joint limits.")

        # Get the robot parameters
        robot_params = RobotParams().get_params()[1]
        speed_profile_str = speed_profile.value
        speed_profile_slow_str = SpeedProfile.SLOW.value
        self.joint_pos_lim: Dict[Joint, Tuple[float, float]] = {}
        self.joint_vel_abs_lim: Dict[Joint, Tuple[float, float]] = {}

        # Get the velocity limits for the controllable joints
        joint_map = {
            Joint.ARM_LIFT: ("lift", "vel_m"),
            Joint.ARM_L0: ("arm", "vel_m"),
            Joint.COMBINED_ARM: ("arm", "vel_m"),
            Joint.WRIST_EXTENSION: ("arm", "vel"),
            Joint.WRIST_YAW: ("wrist_yaw", "vel"),
            Joint.WRIST_PITCH: ("wrist_pitch", "vel"),
            Joint.WRIST_ROLL: ("wrist_roll", "vel"),
            Joint.HEAD_PAN: ("head_pan", "vel"),
            Joint.HEAD_TILT: ("head_tilt", "vel"),
            Joint.GRIPPER_RIGHT: ("stretch_gripper", "vel"),
            Joint.GRIPPER_LEFT: ("stretch_gripper", "vel"),
        }
        for joint_name in Joint:
            if joint_name in joint_map:
                module, vel_key = joint_map[joint_name]
                try:
                    max_abs_vel = robot_params[module]["motion"][speed_profile_str][
                        vel_key
                    ]
                    min_abs_vel = robot_params[module]["motion"][
                        speed_profile_slow_str
                    ][vel_key]
                except KeyError:
                    self.node.get_logger().error(
                        f"Failed to get velocity limits for joint name: {joint_name}"
                    )
                    max_abs_vel = 0.0
                    min_abs_vel = 0.0
            elif joint_name == Joint.BASE_ROTATION:
                # https://github.com/hello-robot/stretch_visual_servoing/blob/f99342/normalized_velocity_control.py#L21
                max_abs_vel = 0.5  # rad/s
                min_abs_vel = 0.05  # rad/s
            else:
                self.node.get_logger().debug(
                    f"Will not get limits for joint name: {joint_name}"
                )
                max_abs_vel = 0.0
                min_abs_vel = 0.0
            self.joint_vel_abs_lim[joint_name] = (
                float(min_abs_vel),
                float(max_abs_vel),
            )

        # Get the position limits for all joints.
        with self.latest_joint_limits_lock:
            joint_pos_lim = self.latest_joint_limits
        if joint_pos_lim is None:
            self.node.get_logger().error("Failed to get joint limits.")
            return False

        for joint_name, (min_pos, max_pos) in joint_pos_lim.items():
            if joint_name == Joint.COMBINED_ARM:
                joint_name = Joint.ARM_L0
            self.joint_pos_lim[joint_name] = (min_pos, max_pos)
        self.joint_pos_lim[Joint.BASE_ROTATION] = (-np.pi, np.pi)

        return True

    def __joint_state_cb(self, msg: JointState) -> None:
        """
        Callback for the joint state subscriber. Save the latest joint state message.

        Note that we set any joint not in the message, e.g., "joint_base_translation" and
        "joint_base_revolution", to 0.0. The reason this works is that we represent the
        end effector goal in the odom frame. As the base moves, the base link moves relative
        to the odom frame, which means the end effector goal gets closer to the base link.
        Hence, it is unnecessary to set non-zero joint values for the base translation and
        revolution joints, as doing so would double-count base motion.

        Parameters
        ----------
        msg: The joint state message.
        """
        with self.latest_joint_state_lock:
            self.latest_joint_state = {
                Joint(joint_name): msg.position[i]
                for i, joint_name in enumerate(msg.name)
            }

    def __joint_limits_cb(self, msg: JointState) -> None:
        """
        Callback for the joint limits subscriber. Save the latest joint limits message.

        Note that the Stretch driver overloads the JointState message by using
        position to indicate the lower limit and velocity to indicate the upper limit.

        Parameters
        ----------
        msg: The joint limits message.
        """
        with self.latest_joint_limits_lock:
            self.latest_joint_limits = {}
            for i, joint_name in enumerate(msg.name):
                try:
                    self.latest_joint_limits[Joint(joint_name)] = (
                        msg.position[i],
                        msg.velocity[i],
                    )
                except ValueError:
                    # We don't yet consider these limits, e.g., gripper_aperture
                    continue

    def move_to_joint_positions(
        self,
        joint_positions: Dict[Joint, float],
        velocity_overrides: Dict[Joint, float] = {},
        rate_hz: float = 15.0,
        timeout_secs: float = 10.0,
        check_cancel: Callable[[], bool] = lambda: False,
        threshold_factor: float = 50.0,
        num_allowable_failures: int = 2,
    ) -> Generator[MotionGeneratorRetval, None, None]:
        """
        Move the arm joints to a specific position. This function is closed-loop, and
        terminates once the joint posiiton has been reached.

        Parameters
        ----------
        joint_positions: The target joint positions. The expectation is that arm length
            joints will already be combined.
        velocity_overrides: For any joints in this dict, we will use the corresponding
            velocity as the commanded velocity profile, as opposed to the max.
        rate_hz: The rate in Hz at which to control the robot.
        timeout_secs: The timeout in seconds.
        check_cancel: A function that returns True if the action should be cancelled.
        threshold_factor: The factor by which to divide the joint range to get the tolerance.
            A larger number results in a smaller tolerance and more precise motion. But
            too large may result in the robot never reaching the target position.
        num_allowable_failures: The number of allowable failures in the FollowJointTrajectory
            action before we give up.

        Returns
        -------
        MotionGeneratorRetval: The return value for the action.
        """
        # Check if the controller is initialized
        if not self.initialized:
            self.node.get_logger().error("Controller is not initialized.")
            yield MotionGeneratorRetval.FAILURE
            return

        # Start the timer
        start_time = self.node.get_clock().now()
        timeout = Duration(seconds=timeout_secs)

        # Limit the joint positions
        _, joint_positions = self.check_joint_limits(joint_positions)
        self.node.get_logger().debug(f"Target Joint Positions: {joint_positions}")

        # The duration of each trajectory command
        duration = 1.0  # seconds

        # Command motion until the termination criteria is reached
        send_goal_future = None
        get_result_future = None
        goal_handle = None

        def cleanup():
            nonlocal goal_handle
            self.node.get_logger().debug("Cleaning up...")
            if goal_handle is not None:
                self.node.get_logger().debug("Cancelling the current trajectory...")
                _ = goal_handle.cancel_goal_async()
                self.node.get_logger().debug("Cancelled the current trajectory.")

        num_failures = 0
        while not check_cancel():
            self.node.get_logger().debug("Loop Started...")
            # Leave early if ROS shuts down or timeout is reached
            if not rclpy.ok() or remaining_time(
                self.node.get_clock().now(), start_time, timeout
            ) <= Duration(seconds=0.0):
                cleanup()
                yield MotionGeneratorRetval.FAILURE
                return

            # Get the current joint state
            latest_joint_state_combined_arm = self.get_current_joints(combine_arm=True)

            # Remove joints that have reached their set point
            joint_positions_cmd = {}
            for joint_name, joint_position in joint_positions.items():
                joint_err = joint_position - latest_joint_state_combined_arm[joint_name]
                tolerance = 0.05
                if joint_name in self.joint_pos_lim:
                    min_pos, max_pos = self.joint_pos_lim[joint_name]
                    tolerance = (max_pos - min_pos) / threshold_factor
                self.node.get_logger().debug(
                    f"Joint {joint_name} error: {joint_err}, tolerance: {tolerance}"
                )
                if abs(joint_err) > tolerance:
                    joint_positions_cmd[joint_name] = joint_position

            # If no joints to move, break. This is necessary because sometimes the wrist
            # reaches the goal but stretch_driver doesn't realize it has reached the goal
            # so keeps waiting until timeout.
            if len(joint_positions_cmd) == 0:
                cleanup()
                yield MotionGeneratorRetval.SUCCESS
                return
            # Command the robot to move to the joint positions
            if send_goal_future is None and get_result_future is None:
                # Command the robot to move to the joint positions
                self.node.get_logger().debug(
                    f"Commanding robot to move to joint positions: {joint_positions_cmd}"
                )
                send_goal_future = self.__command_move_to_joint_position(
                    joint_positions_cmd, duration, velocity_overrides=velocity_overrides
                )
            # Check if the goal has been accepted/rejected yet
            elif send_goal_future is not None and send_goal_future.done():
                try:
                    goal_handle = send_goal_future.result()
                    get_result_future = goal_handle.get_result_async()
                    if not goal_handle.accepted:
                        raise Exception("Move to joint position goal rejected")
                except Exception:
                    self.node.get_logger().error(traceback.format_exc())
                    cleanup()
                    yield MotionGeneratorRetval.FAILURE
                    return
                send_goal_future = None
            # Check if the goal has finished yet
            elif get_result_future is not None and get_result_future.done():
                try:
                    result = get_result_future.result()
                    # Even if the result is success, we don't terminate the loop,
                    # in case the robot hasn't actually reached its target joint position
                    # and we need to re-invoke the action.
                    if (
                        result.status != GoalStatus.STATUS_SUCCEEDED
                        or result.result.error_code
                        != FollowJointTrajectory.Result.SUCCESSFUL
                    ):
                        num_failures += 1
                        if num_failures > num_allowable_failures:
                            raise Exception(
                                "FollowJointTrajectory action failed {num_failures} times. Aborting."
                            )
                except Exception:
                    self.node.get_logger().error(traceback.format_exc())
                    cleanup()
                    yield MotionGeneratorRetval.FAILURE
                    return
                get_result_future = None
            else:
                self.node.get_logger().debug(
                    "Waiting for previous command to finish..."
                )

            yield MotionGeneratorRetval.CONTINUE

        cleanup()
        yield MotionGeneratorRetval.FAILURE if check_cancel() else MotionGeneratorRetval.SUCCESS
        return

    def move_to_ee_pose_inverse_jacobian(
        self,
        goal: PoseStamped,
        articulated_joints: List[Joint],
        termination: TerminationCriteria,
        joint_position_overrides: Dict[Joint, float] = {},
        rate_hz: float = 15.0,
        timeout_secs: float = 10.0,
        check_cancel: Callable[[], bool] = lambda: False,
        err_callback: Optional[Callable[[npt.NDArray[float]], None]] = None,
        get_cartesian_mask: Optional[
            Callable[[npt.NDArray[float]], npt.NDArray[bool]]
        ] = None,
    ) -> Generator[MotionGeneratorRetval, None, None]:
        """
        Move the end-effector to the goal pose. This function uses closed-loop inverse
        Jacobian control to determine target velocities for the robot's joints.

        Parameters
        ----------
        goal: The goal pose.
        articulated_joints: The articulated joints. This must be a subset of self.articulated_joints.
        termination: The termination criteria.
        joint_position_overrides: Fixed joint positions to use when computing the jacobian.
        rate_hz: The rate in Hz at which to control the robot.
        timeout_secs: The timeout in seconds.
        check_cancel: A function that returns True if the action should be cancelled.
        err_callback: A callback that is called with the error between the end-effector pose
            and the goal pose.
        get_cartesian_mask: A function that takes in the error vector and returns a mask
            specifying the elements of the error to keep.

        Returns
        -------
        MotionGeneratorRetval: The return value for the action.
        """
        # Check if the controller is initialized
        if not self.initialized:
            self.node.get_logger().error("Controller is not initialized.")
            yield MotionGeneratorRetval.FAILURE
            return

        # Start the timer
        start_time = self.node.get_clock().now()
        timeout = Duration(seconds=timeout_secs)

        # Check the articulated joints.
        self.node.get_logger().debug(
            f"Joint position overrides: {joint_position_overrides}"
        )
        articulated_joints = [
            joint_name
            for joint_name in articulated_joints
            if joint_name in self.controllable_joints
        ]
        if len(articulated_joints) == 0:
            self.node.get_logger().error("No articulated joints specified.")
            yield MotionGeneratorRetval.FAILURE
            return
        for joint_name in joint_position_overrides.keys():
            if joint_name in articulated_joints:
                self.node.get_logger().error(
                    f"Cannot pass a fixed position for articulated joint {joint_name}."
                )
                yield MotionGeneratorRetval.FAILURE
                return
        non_articulated_joints_mask = np.array(
            [joint_name not in articulated_joints for joint_name in self.all_joints]
        )

        # Ensure we are only moving either the base (velocity control) or the arm
        # (position control).
        move_base = False
        move_arm = False
        for joint_name in articulated_joints:
            if joint_name == Joint.BASE_ROTATION:
                move_base = True
            else:
                move_arm = True
        if move_base and move_arm:
            self.node.get_logger().error(
                "Cannot articulate base and arm/wrist joints at the same time."
            )
            yield MotionGeneratorRetval.FAILURE
            return

        # Convert the goal pose to the odom frame, so it stays stationary as the robot moves.
        ok, goal_odom = self.__transform_pose(goal, Frame.ODOM, start_time, timeout)
        if not ok:
            yield MotionGeneratorRetval.FAILURE
            return

        # Command motion until the termination criteria is reached
        err = None
        vel = None
        cartesian_mask = None
        while not check_cancel() and not self.__reached_termination(
            termination, err, vel, cartesian_mask
        ):
            self.node.get_logger().debug(" Loop Started...")
            # Leave early if ROS shuts down or timeout is reached
            if not rclpy.ok() or remaining_time(
                self.node.get_clock().now(), start_time, timeout
            ) <= Duration(seconds=0.0):
                yield MotionGeneratorRetval.FAILURE
                return

            # Get the current joint state
            q = self.__get_q(joint_position_overrides, all_joints=True)
            self.node.get_logger().debug(
                f"Joint Positions: {list(zip(self.all_joints, q))}"
            )

            # Get the error between the end-effector pose and the goal pose
            ok, err = self.get_err(
                goal_odom,
                remaining_time(self.node.get_clock().now(), start_time, timeout),
                q_all=q,
                publish_fk=True,
            )
            if not ok:
                yield MotionGeneratorRetval.FAILURE
                return
            if err_callback is not None:
                err_callback(err)
            if get_cartesian_mask is not None:
                cartesian_mask = get_cartesian_mask(err)
            self.node.get_logger().debug(f"Error: {err}")

            # Get the Jacobian matrix for the chain
            J = pinocchio.computeFrameJacobian(
                self.base_ik_solver.model,
                self.base_ik_solver.data,
                q,
                self.base_ik_solver.ee_frame_idx,
                pinocchio.ReferenceFrame.LOCAL_WORLD_ALIGNED,
            )
            self.node.get_logger().debug(f"Jacobian: {J}")

            # Mask the Jacobian matrix to only include the articulated joints
            J[:, non_articulated_joints_mask] = 0.0
            if cartesian_mask is not None:
                J[np.logical_not(cartesian_mask), :] = 0.0

            # Calculate the pseudo-inverse of the Jacobian
            J_pinv = np.linalg.pinv(J, rcond=1e-6)
            self.node.get_logger().debug(f"Jacobian Pseudo-Inverse: {J_pinv}")

            # Re-mask the pseudo-inverse to address any numerical issues
            J_pinv[non_articulated_joints_mask, :] = 0.0
            if cartesian_mask is not None:
                J_pinv[:, np.logical_not(cartesian_mask)] = 0.0

            # Calculate the joint velocities
            vel = self.K @ J_pinv @ err
            self.node.get_logger().debug(
                f"Joint Velocities: {list(zip(self.controllable_joints, vel))}"
            )

            # Execute the velocities
            self.__execute_velocities(vel, move_base, move_arm, rate_hz)

            # Yield control back to the main action loop
            yield MotionGeneratorRetval.CONTINUE

        yield MotionGeneratorRetval.FAILURE if check_cancel() else MotionGeneratorRetval.SUCCESS
        return

    def set_navigation_mode(self, timeout: Duration, rate_hz: float = 10.0) -> bool:
        """
        Set the control mode to navigation.

        Parameters
        ----------
        timeout: The timeout.
        rate_hz: The rate in Hz at which to control the robot.

        Returns
        -------
        bool: True if the control mode was successfully set.
        """
        start_time = self.node.get_clock().now()
        # Invoke the service
        self.node.get_logger().info("Switching to navigation mode...")
        ready = self.switch_to_navigation_client.wait_for_service(
            timeout_sec=timeout.nanoseconds / 1.0e9
        )
        if not ready:
            self.node.get_logger().error(
                f"Service {self.switch_to_navigation_client.srv_name} not available."
            )
            return False
        future = self.switch_to_navigation_client.call_async(Trigger.Request())
        rate = self.node.create_rate(rate_hz)
        while rclpy.ok() and not future.done():
            # Check if we've reached timeout
            if (
                remaining_time(
                    self.node.get_clock().now(), start_time, timeout, return_secs=True
                )
                <= 0.0
            ):
                self.node.get_logger().error("Failed to switch to navigation mode.")
                return False
            rate.sleep()
        if future.done():
            result = future.result()
            if not result.success:
                self.node.get_logger().error("Failed to switch to navigation mode.")
                return False
        return True

    def __transform_pose(
        self,
        pose: PoseStamped,
        target_frame: Union[Frame, str],
        start_time: Time,
        timeout: Duration,
    ) -> Tuple[bool, PoseStamped]:
        """
        Transform a pose stamped to the target frame.

        Note that this function may destructively modify the input pose.

        Parameters
        ----------
        pose: The pose to transform.
        target_frame: The target frame.
        start_time: The start time.
        timeout: The timeout.

        Returns
        -------
        PoseStamped: The transformed pose.
        """
        if isinstance(target_frame, Frame):
            target_frame = target_frame.value
        ok, pose_transformed = tf2_transform(
            self.tf_buffer,
            pose,
            target_frame,
            remaining_time(self.node.get_clock().now(), start_time, timeout),
        )
        if not ok:
            self.node.get_logger().error(
                f"Failed to transform pose {pose} to frame {target_frame}."
            )
            return False, PoseStamped()

        return True, pose_transformed

    def __reached_termination(
        self,
        termination: TerminationCriteria,
        err: Optional[npt.NDArray[float]],
        vel: Optional[npt.NDArray[float]],
        cartesian_mask: Optional[npt.NDArray[bool]] = None,
    ) -> bool:
        """
        Check if the termination criteria has been reached.

        Parameters
        ----------
        termination: The termination criteria.
        err: The error between the end-effector pose and the goal pose.
        vel: The commanded velocity.
        cartesian_mask: A mask specifying the elements of the error to keep.

        Returns
        -------
        bool: True if the termination criteria has been reached.
        """

        if err is None or vel is None:
            return False  # Always allow the first iteration
        if termination == TerminationCriteria.ZERO_VEL:
            # We have reached termination when every joint's commanded
            # velocity is lower than their slowest speed (because after
            # that point, they will no longer move).
            retval = True
            for i, joint_name in enumerate(self.controllable_joints):
                abs_vel = np.abs(vel[i])
                if abs_vel > self.joint_vel_abs_lim[joint_name][0]:
                    retval = False
                    break
            self.node.get_logger().debug(f"Reached Termination {retval}")
            return retval
        elif termination == TerminationCriteria.ZERO_ERR:
            return np.allclose(err[cartesian_mask], 0.0, atol=2.0e-2)
        else:
            self.node.get_logger().error(f"Unknown termination criteria: {termination}")
            return True  # auto-terminate

    def get_err(
        self,
        goal: PoseStamped,
        timeout: Duration,
        q_all: Optional[npt.NDArray[float]] = None,
        publish_fk: bool = False,
    ) -> Tuple[bool, npt.NDArray[float]]:
        """
        Get the error between the goal pose and the current end effector pose.
        Returns the error in base link frame.

        Parameters
        ----------
        goal: The goal end effector pose.
        timeout: The timeout.
        q_all: The joint positions to use to compute the end effector pose.
            If None, use the current joint positions.
        publish_fk: Whether to publish the end-effector pose after forward
            kinematics to the TF tree (e.g., if we were to stop the currently-
            articulated joint right now and move the remaining joints to their
            positions in q_all, the end effector would be at this published pose).

        Returns
        -------
        bool: Whether the error was successfully calculated.
        npt.NDArray[float]: The error in base link frame. The error is a 6D vector
            consisting of the translation and rotation errors.
        """
        # Start the timer
        start_time = self.node.get_clock().now()

        # Get the current end effector pose in base frame
        if q_all is None:
            q_all = self.__get_q(all_joints=True)
        ee_pos, ee_quat = self.ik_solver.compute_fk(
            config=dict(zip(self.all_joints_str, q_all))
        )
        if publish_fk:
            # Transform the end effector pose to the odom frame
            ee_pose = create_ros_pose(ee_pos, ee_quat, Frame.BASE_LINK.value)
            ok, ee_pose_odom = self.__transform_pose(
                ee_pose, Frame.ODOM, start_time, timeout
            )
            if ok:
                self.static_transform_broadcaster.sendTransform(
                    TransformStamped(
                        header=ee_pose_odom.header,
                        child_frame_id="fk_end_effector",
                        transform=Transform(
                            translation=Vector3(
                                x=ee_pose_odom.pose.position.x,
                                y=ee_pose_odom.pose.position.y,
                                z=ee_pose_odom.pose.position.z,
                            ),
                            rotation=ee_pose_odom.pose.orientation,
                        ),
                    )
                )

        # Get the goal end effector pose in base frame
        goal.header.stamp = Time()  # Get the most recent transform
        ok, goal_base = self.__transform_pose(
            goal, Frame.BASE_LINK, start_time, timeout
        )
        if not ok:
            return False, np.zeros(6)

        # Get the error in base frame
        err = np.zeros(6, dtype=float)
        err[:3] = np.array(
            [
                goal_base.pose.position.x - ee_pos[0],
                goal_base.pose.position.y - ee_pos[1],
                goal_base.pose.position.z - ee_pos[2],
            ]
        )
        goal_quaternion = [
            goal_base.pose.orientation.x,
            goal_base.pose.orientation.y,
            goal_base.pose.orientation.z,
            goal_base.pose.orientation.w,
        ]
        err_quaternion = quaternion_multiply(
            goal_quaternion, quaternion_inverse(ee_quat)
        )
        yaw, pitch, roll = euler_from_quaternion(
            err_quaternion,
            axes="rzyx",  # https://wiki.ros.org/geometry2/RotationMethods#Fixed_Axis_vs_Euler_Angles
        )
        err[3:] = np.array([roll, pitch, yaw])

        return True, err

    def __execute_velocities(
        self,
        velocities: npt.NDArray[float],
        move_base: bool,
        move_arm: bool,
        rate_hz: float = 10.0,
        forward_project_velocities_secs: float = 0.5,
    ) -> bool:
        """
        Send the velocities to the ROS2 controllers.

        Parameters
        ----------
        joint_velocities: The joint velocities.
        move_base: Whether to move the base.
        move_arm: Whether to move the arm.
        rate_hz: The rate in Hz at which to control the robot.
        forward_project_velocities_secs: How many seconds to forward-project velocities for
            when commanding the arm in position mode.

        Returns
        -------
        bool: True if it successfully sent the velocities to be executed.
        """
        # Check the parameters
        if move_base and move_arm or (not move_base and not move_arm):
            self.node.get_logger().error(
                "Exactly one of the base or the arm must be articulated."
            )
            return False

        # If moving the arm, wait until the previous arm command is done
        if move_arm:
            if self.arm_client_send_goal_future is not None:
                if self.arm_client_send_goal_future.done():
                    goal_handle = self.arm_client_send_goal_future.result()
                    self.arm_client_get_result_future = goal_handle.get_result_async()
                    self.arm_client_send_goal_future = None
                    return True
                else:
                    self.node.get_logger().debug(
                        "Waiting for previous arm goal to be accepted..."
                    )
                    return True
            elif self.arm_client_get_result_future is not None:
                if self.arm_client_get_result_future.done():
                    result = self.arm_client_get_result_future.result()
                    if (
                        result.status != GoalStatus.STATUS_SUCCEEDED
                        or result.result.error_code
                        != FollowJointTrajectory.Result.SUCCESSFUL
                    ):
                        self.node.get_logger().debug(
                            "Previous arm goal failed. Will try again."
                        )
                    self.arm_client_get_result_future = None
                else:
                    self.node.get_logger().debug(
                        "Waiting for previous arm goal to finish..."
                    )
                    return True

        # Clip the velocities
        joint_velocities = dict(zip(self.controllable_joints, velocities))
        self.node.get_logger().debug(f"Pre-Clip Velocities: {joint_velocities}")
        _, clipped_velocities = self.check_velocity_limits(joint_velocities)
        self.node.get_logger().debug(f"Commanding Velocities: {clipped_velocities}")

        # Send base commands
        if move_base:
            base_vel = Twist()
            base_vel.angular.z = clipped_velocities[Joint.BASE_ROTATION]
            self.base_vel_pub.publish(base_vel)
            return True

        # Send arm commands
        q = self.__get_q(all_joints=True)
        joint_positions = {}
        for joint_name, vel in clipped_velocities.items():
            if (
                joint_name != Joint.BASE_ROTATION
                and joint_name in self.all_joints
                and not np.isclose(clipped_velocities[joint_name], 0.0)
            ):
                pos = q[self.all_joints.index(joint_name)]
                joint_positions[joint_name] = (
                    pos + vel * forward_project_velocities_secs
                )
        self.arm_client_send_goal_future = self.__command_move_to_joint_position(
            joint_positions, forward_project_velocities_secs
        )

        return True

    def __command_move_to_joint_position(
        self,
        joint_positions: Dict[Joint, float],
        duration_sec: float,
        velocity_overrides: Dict[Joint, float] = {},
    ) -> Future:
        """
        Commands the robot arm to move to the specified joint positions.

        Parameters
        ----------
        joint_positions: The joint positions.
        duration_sec: The duration in seconds to reach the joint positions.
        velocity_overrides: For any joints in this dict, we will use the corresponding
            velocity as the commanded velocity profile, as opposed to the max.

        Returns
        -------
        Future: The future object.
        """
        # Limit the joint positions
        _, joint_positions = self.check_joint_limits(joint_positions)
        self.node.get_logger().debug(f"Commanding arm to {joint_positions}")

        # Replace the distal arm joint with the combined joint
        if Joint.ARM_L0 in joint_positions:
            joint_positions[Joint.COMBINED_ARM] = joint_positions.pop(Joint.ARM_L0)

        # Create the goal
        arm_goal = FollowJointTrajectory.Goal()
        arm_goal.trajectory.joint_names = [
            joint.value for joint in joint_positions.keys()
        ]
        arm_goal.trajectory.points = [JointTrajectoryPoint()]
        arm_goal.trajectory.points[0].positions = list(joint_positions.values())
        # Add the target joint velocities in the velocity field. This is because the Stretch ROS2
        # implementation of the FollowJointTrajectory action server overloads the goal type to
        # also pass the velocity/effort profile.
        if len(velocity_overrides) > 0:
            arm_goal.trajectory.points[0].velocities = [
                velocity_overrides[joint]
                if joint in velocity_overrides
                else self.joint_vel_abs_lim[joint][1]
                for joint in joint_positions.keys()
            ]
        arm_goal.trajectory.points[0].time_from_start = Duration(
            seconds=duration_sec,
        ).to_msg()
        self.node.get_logger().debug(f"Commanding arm to {arm_goal}")
        return self.arm_client.send_goal_async(arm_goal)

    def check_joint_limits(
        self,
        joint_positions: Dict[Joint, float],
        clip: bool = True,
    ) -> Tuple[bool, Dict[Joint, float]]:
        """
        Check if the joint positions are within the limits. Optionally clip the positions.

        Parameters
        ----------
        joint_positions: The joint positions.
        clip: Whether to clip the joint positions to the limits. IF false,
            returns the joint positions as is.

        Returns
        -------
        Tuple[bool, Dict[Joint, float]]: Whether the joint positions are within the limits
            and the joint positions (clipped if requested).
        """
        # Check and clip the joint positions
        in_limits = True
        clipped_joint_positions = {}
        for joint_name, pos in joint_positions.items():
            if joint_name in self.joint_pos_lim:
                min_pos, max_pos = self.joint_pos_lim[joint_name]
                if pos < min_pos or pos > max_pos:
                    in_limits = False
                if clip:
                    clipped_joint_positions[joint_name] = np.clip(pos, min_pos, max_pos)
            else:
                clipped_joint_positions[joint_name] = pos

        return in_limits, clipped_joint_positions if clip else joint_positions

    def check_velocity_limits(
        self,
        joint_velocities: Dict[Joint, float],
        clip: bool = True,
        zero_thresh: float = 1.0e-3,
    ) -> Tuple[bool, Dict[Joint, float]]:
        """
        Check if the joint velocities are within the limits. Optionally clip the velocities.

        Parameters
        ----------
        joint_velocities: The joint velocities.
        clip: Whether to clip the joint velocities to the limits.
        zero_thresh: The threshold below which a velocity is considered zero.

        Returns
        -------
        Tuple[bool, Dict[Joint, float]]: Whether the joint velocities are within the limits
        """
        # Check and clip the joint velocities
        in_limits = True
        clipped_joint_velocities = {}
        for joint_name, vel in joint_velocities.items():
            if joint_name in self.joint_vel_abs_lim:
                min_abs_vel, max_abs_vel = self.joint_vel_abs_lim[joint_name]
                if vel < min_abs_vel or vel > max_abs_vel:
                    in_limits = False
                if clip:
                    if vel >= zero_thresh:
                        clipped_joint_velocities[joint_name] = np.clip(
                            vel, min_abs_vel, max_abs_vel
                        )
                    elif vel <= -zero_thresh:
                        clipped_joint_velocities[joint_name] = np.clip(
                            vel, -max_abs_vel, -min_abs_vel
                        )
                    else:
                        clipped_joint_velocities[joint_name] = 0.0
            else:
                clipped_joint_velocities[joint_name] = vel

        return in_limits, clipped_joint_velocities if clip else joint_velocities

    def solve_ik(
        self,
        goal: PoseStamped,
        joint_position_overrides: Dict[Joint, float] = {},
        max_tries: int = 5,
    ) -> Tuple[bool, Dict[Joint, float]]:
        """
        Solve the inverse kinematics problem.

        Parameters
        ----------
        goal: The goal pose.
        joint_position_overrides: joint positions to use. Any joint positions
            not in here will use the latest joint state.

        Returns
        -------
        Dict[Joint, float]: The joint positions.
        """
        # Convert the goal to base link frame
        if goal.header.frame_id != Frame.BASE_LINK:
            ok, goal_base = self.__transform_pose(
                goal,
                Frame.BASE_LINK,
                self.node.get_clock().now(),
                Duration(seconds=0.5),
            )
            if not ok:
                return False, {}
        else:
            goal_base = goal

        # Get the inputs
        pos, quat = get_pos_quat_from_ros(goal_base)

        # To encourage the IK solver to compute positive arm lengths,
        # we seed it with arm length at the maximum distance.
        # We also add other fully random configurations in case the
        # first one fails.
        q_init = self.__get_q(joint_position_overrides, all_joints=True)
        q_init[self.controllable_joints.index(Joint.ARM_L0)] = self.joint_pos_lim[
            Joint.ARM_L0
        ][1]
        initializations = [q_init]
        for _ in range(max_tries - 1):
            initializations.append(self.__get_random_q(all_joints=True))

        for q_init in initializations:
            # Solve the IK problem
            q, success, debug_info = self.ik_solver.compute_ik(
                pos, quat, q_init=dict(zip(self.all_joints_str, q_init))
            )
            self.node.get_logger().debug(
                f"For initiatilization {dict(zip(self.all_joints_str, q_init))}, "
                f"success: {success}, q: {q} debug_info: {debug_info}"
            )
            joint_positions = dict(zip(self.controllable_joints, q))
            if success:
                # Check whether the controllable joints are within their limits
                within_limits, _ = self.check_joint_limits(joint_positions, clip=False)
                if within_limits:
                    return True, joint_positions

        return False, joint_positions

    def solve_fk(
        self, joint_overrides: Dict[Joint, float] = {}, link: Optional[Frame] = None
    ) -> Tuple[npt.NDArray, npt.NDArray]:
        """
        Solve the forward kinematics problem.

        Parameters
        ----------
        joint_overrides: The joint positions. For any joints not in this, we will use the latest
            joint state.
        link: The link to compute the forward kinematics for. If None, compute
            the forward kinematics for the end effector.

        Returns
        -------
        Tuple[npt.NDArray, npt.NDArray]: The position and quaternion of the end effector.
        """
        link_name: Optional[str] = None
        if link is not None:
            link_name = link.value
        q = self.__get_q(joint_overrides, all_joints=True)
        pos, quat = self.ik_solver.compute_fk(
            config=dict(zip(self.all_joints_str, q)), link_name=link_name
        )
        self.node.get_logger().debug(f"FK for {q} {link}: {pos}, {quat}")
        return (pos, quat)

    def get_transform(
        self,
        parent_link: Frame,
        child_link: Frame,
        joint_overrides: Dict[Joint, float] = {},
    ) -> npt.NDArray:
        """
        Get the transform between two links.

        Parameters
        ----------
        joint_overrides: The joint positions. For any joints not in this, we will use the latest
            joint state.
        parent_link: The parent link.
        child_link: The child link.

        Returns
        -------
        npt.NDArray: The homogeneous (4x4) transform matrix. Multiplying this by
            a position in child frame will yield a position in parent frame.
        """
        # Get the transform from the base to the parent
        if parent_link == Frame.BASE_LINK:
            b_T_p = np.eye(4)
        else:
            pos, quat = self.solve_fk(joint_overrides, parent_link)
            b_T_p = quaternion_matrix(quat)
            b_T_p[:3, 3] = pos

        # Get the transform from the base to the child
        if child_link == Frame.BASE_LINK:
            b_T_c = np.eye(4)
        else:
            pos, quat = self.solve_fk(joint_overrides, child_link)
            b_T_c = quaternion_matrix(quat)
            b_T_c[:3, 3] = pos

        # Get the transform from the parent to the child
        p_T_c = np.linalg.inv(b_T_p) @ b_T_c
        return p_T_c

    def get_current_joints(self, combine_arm: bool = True) -> Dict[Joint, float]:
        """
        Get the current states of the controllable joints.

        Parameters
        ----------
        combine_arm: Whether to combine the telescoping joints into a single joint.

        Returns
        -------
        Dict[Joint, float]: The joint positions
        """
        # Get the latest joints
        with self.latest_joint_state_lock:
            latest_joint_state = self.latest_joint_state

        # Get the positions
        joint_positions = {Joint.ARM_L0: 0.0}
        for joint_name in latest_joint_state:
            pos = latest_joint_state[joint_name]
            if combine_arm and joint_name in Joint.get_arm_joints():
                joint_positions[Joint.ARM_L0] += pos
            else:
                joint_positions[joint_name] = pos

        return joint_positions

    def __get_q(
        self,
        joint_position_overrides: Dict[Joint, float] = {},
        all_joints: bool = False,
    ) -> npt.NDArray[float]:
        """
        Get the current states of the controllable joints.

        Parameters
        ----------
        joint_position_overrides: override the joint positions with these values.
        all_joints: whether to use all joints or only the controllable ones.

        Returns
        -------
        npt.NDArray: The joint positions
        """
        # Determine which joints we are returning
        if all_joints:
            joints = self.all_joints
        else:
            joints = self.controllable_joints

        # Get the latest joints
        latest_joint_state_combined_arm = self.get_current_joints(combine_arm=True)

        # Get the positions
        joint_positions = []
        for joint_name in joints:
            if joint_name in joint_position_overrides:
                joint_positions.append(joint_position_overrides[joint_name])
            elif joint_name in latest_joint_state_combined_arm:
                joint_positions.append(latest_joint_state_combined_arm[joint_name])
            else:
                # Set dummy joints to 0.0
                joint_positions.append(0.0)
        return np.array(joint_positions, dtype=float)

    def __get_random_q(self, all_joints: bool = False):
        """
        Get a random joint configuration.

        Parameters
        ----------
        all_joints: whether to use all joints or only the controllable ones.

        Returns
        -------
        npt.NDArray: The joint positions
        """
        if all_joints:
            joints = self.all_joints
        else:
            joints = self.controllable_joints
        q = []
        for joint_name in joints:
            q.append(
                np.random.uniform(
                    self.joint_pos_lim[joint_name][0], self.joint_pos_lim[joint_name][1]
                )
            )
        return np.array(q, dtype=float)
