import React from 'react'
import ROSLIB from 'roslib';
import { cmd, DriveCommand, CameraPerspectiveCommand, IncrementalMove, setRobotModeCommand, VelocityCommand, RobotPoseCommand, ToggleCommand, LookAtGripper, GetOccupancyGrid, MoveBaseCommand } from 'shared/commands';
import { ValidJointStateDict, RobotPose, ValidJoints, ROSPose, AMCLPose } from 'shared/util';

export type robotMessageChannel = (message: cmd) => void;

export class RemoteRobot extends React.Component {
    robotChannel: robotMessageChannel;
    sensors: RobotSensors
    mapPose: ROSLIB.Transform;

    constructor(props: { robotChannel: robotMessageChannel }) {
        super(props);
        this.robotChannel = props.robotChannel
        this.sensors = new RobotSensors({})
        this.mapPose = {
            translation: {
                x: 0, y: 0, z: 0
            } as ROSLIB.Vector3,
            rotation: {
                x: 0, y: 0, z: 0, w: 0
            } as ROSLIB.Quaternion
        } as ROSLIB.Transform
    }

    driveBase(linVel: number, angVel: number): VelocityCommand {
        let cmd: DriveCommand = {
            type: "driveBase",
            modifier: { linVel: linVel, angVel: angVel }
        };
        this.robotChannel(cmd);

        return {
            "stop": () => {
                let stopEvent: DriveCommand = {
                    type: "driveBase",
                    modifier: { linVel: 0, angVel: 0 }
                }
                this.robotChannel(stopEvent)
            },
            "affirm": () => {
                let affirmEvent: DriveCommand = {
                    type: "driveBase",
                    modifier: { linVel: linVel, angVel: angVel }
                }
                this.robotChannel(affirmEvent)
            }
        }
    }

    incrementalMove(jointName: ValidJoints, increment: number): VelocityCommand {
        let cmd: IncrementalMove = {
            type: "incrementalMove",
            jointName: jointName,
            increment: increment
        };
        this.robotChannel(cmd);

        return {
            "stop": () => {
                this.robotChannel({ type: "stop" })
            }
        }
    }

    setRobotMode(mode: "position" | "navigation") {
        let cmd: setRobotModeCommand = {
            type: "setRobotMode",
            modifier: mode
        };
        this.robotChannel(cmd)
    }

    setCameraPerspective(camera: "overhead" | "realsense" | "gripper", perspective: string) {
        let cmd: CameraPerspectiveCommand = {
            type: "setCameraPerspective",
            camera: camera,
            perspective: perspective
        }
        this.robotChannel(cmd)
    }

    setRobotPose(pose: RobotPose) {
        let cmd: RobotPoseCommand = {
            type: "setRobotPose",
            pose: pose,
        }
        this.robotChannel(cmd)
    }

    moveBase(pose: ROSPose) {
        let cmd: MoveBaseCommand = {
            type: "moveBase",
            pose: pose
        }
        this.robotChannel(cmd)
    }
    
    setToggle(type: "setFollowGripper" | "setDepthSensing", toggle: boolean) {
        let cmd: ToggleCommand = {
            type: type,
            toggle: toggle
        }
        this.robotChannel(cmd)
    }

    lookAtGripper(type: "lookAtGripper") {
        let cmd: LookAtGripper = {
            type: type
        }
        this.robotChannel(cmd)
    }

    getOccupancyGrid(type: "getOccupancyGrid") {
        let cmd: GetOccupancyGrid = {
            type: type
        }
        this.robotChannel(cmd)
    }

    setMapPose(pose: ROSLIB.Transform) {
        console.log(pose)
        this.mapPose = pose
    }

    getMapPose() {
        return this.mapPose
    }
}

class RobotSensors extends React.Component {
    private robotPose: RobotPose = {};
    private inJointLimits: ValidJointStateDict = {};
    private inCollision: ValidJointStateDict = {};
    private functionProviderCallback?: (inJointLimits: ValidJointStateDict, inCollision: ValidJointStateDict) => void;

    constructor(props: {}) {
        super(props)
        this.functionProviderCallback = () => { }
        this.setFunctionProviderCallback = this.setFunctionProviderCallback.bind(this)
    }

    /**
     * Handler for joint state messages with information about if individual 
     * joints are in collision or at their limit.
     * 
     * @param jointValues mapping of joint name to a pair of booleans for 
     *                    [joint is within lower limit, joint is within upper limit]
     * @param effortValues mapping for joint name to pair of booleans for 
     *                     [joint in collision at lower end, joint is in 
     *                     collision at upper end]
     */
    checkValidJointState(robotPose: RobotPose, jointValues: ValidJointStateDict, effortValues: ValidJointStateDict) {
        if (robotPose !== this.robotPose) {
            this.robotPose = robotPose;
        }

        // Remove existing values from list
        let change = false;
        Object.keys(jointValues).forEach((k) => {
            const key = k as ValidJoints;
            
            const same = key in this.inJointLimits ?
                jointValues[key]![0] == this.inJointLimits[key]![0] &&
                jointValues[key]![1] == this.inJointLimits[key]![1] : false;
            // If same value, remove from dict so not passed to callback
            if (same) delete jointValues[key];
            else {
                change = true;
                this.inJointLimits[key] = jointValues[key];
            }
        })
        Object.keys(effortValues).forEach((k) => {
            const key = k as ValidJoints;
            const same = key in this.inCollision ?
                effortValues[key]![0] == this.inCollision[key]![0] &&
                effortValues[key]![1] == this.inCollision[key]![1] : false;
            // If same value, remove from dict so not passed to callback
            if (same) delete effortValues[key];
            else {
                change = true;
                this.inCollision[key] = effortValues[key];
            }
        })

        // Only callback when value has changed
        if (change && this.functionProviderCallback) {
            console.log(jointValues, effortValues);
            this.functionProviderCallback(jointValues, effortValues);
        }
    }

    /**
     * Records a callback from the function provider. The callback is called 
     * whenever a joint state "at limit" or "in collision" changes.
     * 
     * @param callback callback to function provider
     */
    setFunctionProviderCallback(callback: (inJointLimits: ValidJointStateDict, inCollision: ValidJointStateDict) => void) {
        this.functionProviderCallback = callback;
    }

    /**
     * @returns current robot pose
     */
    getRobotPose(head: boolean, gripper: boolean, arm: boolean): RobotPose {
        let filteredPose: RobotPose = {}
        if (head) {
            filteredPose["joint_head_tilt"] = this.robotPose["joint_head_tilt"]
            filteredPose["joint_head_pan"] = this.robotPose["joint_head_pan"]
        }
        if (gripper) {
            filteredPose["joint_wrist_yaw"] = this.robotPose["joint_wrist_yaw"]
            filteredPose["joint_gripper_finger_left"] = this.robotPose["joint_gripper_finger_left"]
        }
        if (arm) {
            filteredPose["joint_lift"] = this.robotPose["joint_lift"]
            filteredPose["wrist_extension"] = this.robotPose["wrist_extension"]
        }
        return filteredPose
    }
}