from __future__ import annotations  # Required for type hinting a class within itself

# Standard imports
from enum import Enum
from typing import Callable, Dict, Generator, List, Optional

# Third-party imports
import numpy as np
import numpy.typing as npt
from geometry_msgs.msg import PoseStamped

# Local imports
from .constants import (
    Joint,
    get_gripper_configuration,
    get_pregrasp_wrist_configuration,
    get_stow_configuration,
)
from .stretch_ik_control import (
    MotionGeneratorRetval,
    StretchIKControl,
    TerminationCriteria,
)


class MoveToPregraspState(Enum):
    """
    The below states can be strung together to form a state machine that moves the robot
    to a pregrasp position. The general principle we follow is that the robot should only
    rotate its base and move the lift when its arm is within the base footprint of the robot
    (i.e., the arm length is fully in and the wrist is stowed).
    """

    # Stow the arm until the gripper would collide with the base if the gripper were vertically down.
    STOW_ARM_LENGTH_PARTIAL = -1
    # Stow the arm fully.
    STOW_ARM_LENGTH_FULL = 0
    STOW_WRIST = 1
    STOW_ARM_LIFT = 2
    ROTATE_BASE = 3
    HEAD_PAN = 4
    LIFT_ARM = 5
    MOVE_WRIST_YAW = 6
    MOVE_WRIST_PITCH_ROLL = 7
    LENGTHEN_ARM = 8
    TERMINAL = 9

    @staticmethod
    def get_state_machine(
        horizontal_grasp: bool,
        init_lift_near_base: bool,
        goal_lift_near_base: bool,
        init_length_near_mast: bool,
    ) -> List[List[MoveToPregraspState]]:
        """
        Get the default state machine.

        Parameters
        ----------
        horizontal_grasp: Whether the robot will be grasping the object horizontally
            (True) or vertically (False).
        init_lift_near_base: Whether the robot's arm is near the base at the start.
        goal_lift_near_base: Whether the robot's arm should be near the base at the end.
        init_length_near_mast: Whether the robot's arm length is near the mast at the start.

        Returns
        -------
        List[List[MoveToPregraspState]]: The default state machine. Each list of states
            (axis 0) will be executed sequentially. Within a list of states (axis 1), the
            states will be executed in parallel.
        """
        states = []
        # If the current arm lift is near the base, and the length is not already near the mast,
        # move the arm to the stow height before fully stowing the arm length. This is to account
        # for the case where the wrist is vertically down and may collide with the base.
        if init_lift_near_base:
            if not init_length_near_mast:
                states.append([MoveToPregraspState.STOW_ARM_LENGTH_PARTIAL])
            states.append([MoveToPregraspState.STOW_ARM_LIFT])
            states.append([MoveToPregraspState.STOW_ARM_LENGTH_FULL])
        else:
            states.append([MoveToPregraspState.STOW_ARM_LENGTH_FULL])
        states.append([MoveToPregraspState.STOW_WRIST])
        # If the goal arm lift is near the base and we haven't already stowed the arm lift, stow the arm lift.
        if goal_lift_near_base and MoveToPregraspState.STOW_ARM_LIFT not in states:
            states.append([MoveToPregraspState.STOW_ARM_LIFT])
        states.append([MoveToPregraspState.ROTATE_BASE, MoveToPregraspState.HEAD_PAN])
        # If the goal is near the base and we're doing a vertical grasp, lengthen the arm before deploying the wrist.
        if goal_lift_near_base:
            states.append([MoveToPregraspState.LENGTHEN_ARM])
            states.append([MoveToPregraspState.MOVE_WRIST_YAW])
            states.append([MoveToPregraspState.MOVE_WRIST_PITCH_ROLL])
            states.append([MoveToPregraspState.LIFT_ARM])
        else:
            states.append([MoveToPregraspState.LIFT_ARM])
            states.append([MoveToPregraspState.MOVE_WRIST_YAW])
            states.append([MoveToPregraspState.MOVE_WRIST_PITCH_ROLL])
            states.append([MoveToPregraspState.LENGTHEN_ARM])
        states.append([MoveToPregraspState.TERMINAL])

        return states

    def get_motion_executor(
        self,
        controller: StretchIKControl,
        goal_pose: PoseStamped,
        ik_solution: Dict[Joint, float],
        horizontal_grasp: bool,
        timeout_secs: float,
        check_cancel: Callable[[], bool] = lambda: False,
        err_callback: Optional[Callable[[npt.NDArray[np.float64]], None]] = None,
    ) -> Optional[Generator[MotionGeneratorRetval, None, None]]:
        """
        Get the motion executor for this state.

        Parameters
        ----------
        controller: StretchIKControl: The controller.
        goal_pose: PoseStamped: The goal pose. Only used for states that use inverse
            Jacobian velocity control, e.g., ROTATE_BASE.
        ik_solution: Dict[Joint, float]: The IK solution for the goal pose.
        horizontal_grasp: bool: Whether the robot will be grasping the object horizontally
            (True) or vertically (False).
        timeout_secs: float: The timeout for the motion executor.
        check_cancel: Callable[[], bool]: A function that returns whether the motion should be cancelled.
        err_callback: Optional[Callable[[npt.NDArray[np.float64]], None]]: A callback that is called
            with the error in the pose.
        """
        # The parameters that are state-dependant
        joints_for_velocity_control = []
        joint_position_overrides = {}
        joints_for_position_control = {}
        velocity_overrides = {}
        get_cartesian_mask = None

        # Configure the parameters depending on the state
        if self == MoveToPregraspState.TERMINAL:
            return None
        elif self == MoveToPregraspState.STOW_ARM_LENGTH_FULL:
            joints_for_position_control.update(get_stow_configuration([Joint.ARM_L0]))
        elif self == MoveToPregraspState.STOW_ARM_LENGTH_PARTIAL:
            joints_for_position_control.update(
                get_stow_configuration([Joint.ARM_L0], partial=True)
            )
        elif self == MoveToPregraspState.STOW_ARM_LIFT:
            joints_for_position_control.update(get_stow_configuration([Joint.ARM_LIFT]))
        elif self == MoveToPregraspState.STOW_WRIST:
            joints_for_position_control.update(
                get_stow_configuration(Joint.get_wrist_joints() + [Joint.GRIPPER_LEFT])
            )
        elif self == MoveToPregraspState.ROTATE_BASE:
            joints_for_velocity_control += [Joint.BASE_ROTATION]
            joint_position_overrides.update(
                {
                    joint: position
                    for joint, position in ik_solution.items()
                    if joint != Joint.BASE_ROTATION
                }
            )
            joint_position_overrides.update(
                get_pregrasp_wrist_configuration(horizontal_grasp)
            )

            # Care about yaw error when error is large, but for final positioning,
            # care about x error. This is because our yaw is slightly off, so if
            # we care about both yaw and x for final positioning, it will stop
            # at a slightly off position.
            def get_cartesian_mask(err: npt.NDArray[float]):
                cartesian_mask = np.array([True, False, False, False, False, False])
                err_yaw = err[5]
                if np.abs(err_yaw) > np.pi / 4.0:
                    cartesian_mask[5] = True
                return cartesian_mask

        elif self == MoveToPregraspState.HEAD_PAN:
            desired_base_rotation = ik_solution[Joint.BASE_ROTATION]
            curr_head_pan = controller.get_current_joints()[Joint.HEAD_PAN]
            # The head should rotate in the opposite direction of the base, to
            # keep the field of view roughly the same
            target_head_pan = curr_head_pan - desired_base_rotation
            while target_head_pan < controller.joint_pos_lim[Joint.HEAD_PAN][0]:
                target_head_pan += 2.0 * np.pi
            while target_head_pan > controller.joint_pos_lim[Joint.HEAD_PAN][1]:
                target_head_pan -= 2.0 * np.pi
            joints_for_position_control[Joint.HEAD_PAN] = target_head_pan
            # Cap the head pan at the base's max rotation speed, so the base and head pan
            # camera roughly track each other.
            velocity_overrides[Joint.HEAD_PAN] = controller.joint_vel_abs_lim[
                Joint.BASE_ROTATION
            ][1]
        elif self == MoveToPregraspState.LIFT_ARM:
            joints_for_position_control[Joint.ARM_LIFT] = ik_solution[Joint.ARM_LIFT]
        elif self == MoveToPregraspState.MOVE_WRIST_YAW:
            joints_for_position_control.update(get_gripper_configuration(closed=False))
            joints_for_position_control[
                Joint.WRIST_YAW
            ] = get_pregrasp_wrist_configuration(horizontal_grasp)[Joint.WRIST_YAW]
        elif self == MoveToPregraspState.MOVE_WRIST_PITCH_ROLL:
            joints_for_position_control[
                Joint.WRIST_PITCH
            ] = get_pregrasp_wrist_configuration(horizontal_grasp)[Joint.WRIST_PITCH]
            joints_for_position_control[
                Joint.WRIST_ROLL
            ] = get_pregrasp_wrist_configuration(horizontal_grasp)[Joint.WRIST_ROLL]
        elif self == MoveToPregraspState.LENGTHEN_ARM:
            joints_for_position_control[Joint.ARM_L0] = ik_solution[Joint.ARM_L0]

        # Create the motion executor
        if len(joints_for_velocity_control) > 0:
            return controller.move_to_ee_pose_inverse_jacobian(
                goal=goal_pose,
                articulated_joints=joints_for_velocity_control,
                termination=TerminationCriteria.ZERO_VEL,
                joint_position_overrides=joint_position_overrides,
                timeout_secs=timeout_secs,
                check_cancel=check_cancel,
                err_callback=err_callback,
                get_cartesian_mask=get_cartesian_mask,
            )
        if len(joints_for_position_control) > 0:
            return controller.move_to_joint_positions(
                joint_positions=joints_for_position_control,
                velocity_overrides=velocity_overrides,
                timeout_secs=timeout_secs,
                check_cancel=check_cancel,
            )
        return None
