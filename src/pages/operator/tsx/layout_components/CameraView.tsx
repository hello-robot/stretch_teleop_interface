import React from "react";
import {
    className,
    gripperProps,
    navigationProps,
    realsenseProps,
    RemoteStream,
    StretchTool,
    TabletOrientation,
} from "../../../../shared/util";
import {
    CameraViewDefinition,
    ComponentType,
    CameraViewId,
    ComponentDefinition,
    FixedOverheadVideoStreamDef,
    RealsenseVideoStreamDef,
    AdjustableOverheadVideoStreamDef,
    GripperVideoStreamDef,
} from "../utils/component_definitions";
import { ButtonPad } from "./ButtonPad";
import {
    CustomizableComponentProps,
    isSelected,
    SharedState,
} from "./CustomizableComponent";
import { DropZone } from "./DropZone";
import { PredictiveDisplay } from "./PredictiveDisplay";
import {
    buttonFunctionProvider,
    hasBetaTeleopKit,
    underVideoFunctionProvider,
} from "..";
import {
    ButtonPadButton,
    panTiltButtons,
} from "../function_providers/ButtonFunctionProvider";
import {
    OverheadButtons,
    realsenseButtons,
    realsenseMoveToPregraspButtons,
    RealsenseButtons,
    UnderVideoButton,
    wristButtons,
} from "../function_providers/UnderVideoFunctionProvider";
import { CheckToggleButton } from "../basic_components/CheckToggleButton";
import { AccordionSelect } from "../basic_components/AccordionSelect";
import "operator/css/CameraView.css";
import AddIcon from "@mui/icons-material/Add";
import CancelIcon from "@mui/icons-material/Cancel";
import PlayCircleFilledIcon from "@mui/icons-material/PlayCircleFilled";
import PlayCircle from "@mui/icons-material/PlayCircle";

/**
 * Displays a video stream with an optional button pad overlay
 *
 * @param props properties
 */
export const CameraView = (props: CustomizableComponentProps) => {
    // Reference to the video element
    const videoRef = React.useRef<HTMLVideoElement>(null);
    // X and Y position of the cursor when user clicks on the video while customizing
    const [contextMenuXY, setContextMenuXY] = React.useState<
        [number, number] | null
    >(null);
    // Scaled x and y positions (in [0.0, 1.0]) when the user clicks the realsense stream to select an object
    const [selectObjectScaledXY, setSelectObjectScaledXY] = React.useState<
        [number, number] | null
    >(null);
    // The font size to use for the icon indicating the selected object
    const [selectObjectFontSize, setSelectObjectFontSize] =
        React.useState<string>("1.5em");
    // Whether the robot is currently in the process of moving to a pregrasp position
    const [isMovingToPregrasp, setIsMovingToPregrasp] =
        React.useState<boolean>(false);
    // Whether the robot is currently moving to show the tablet to the user
    const [isShowingTablet, setIsShowingTablet] =
        React.useState<boolean>(false);
    const definition = React.useMemo(
        () => props.definition as CameraViewDefinition,
        [props.definition],
    );
    if (!definition.children)
        console.warn(
            `Video stream definition at ${props.path} should have a 'children' property.`,
        );
    // Reference to the div immediately around the video element
    const videoAreaRef = React.useRef<HTMLDivElement>(null);
    // Reference to the div below the video element
    const underVideoAreaRef = React.useRef<HTMLDivElement>(null);
    // Boolean representing if the video stream needs to be constrained by height
    // (constrained by width otherwise)
    const [constrainedHeight, setConstrainedHeight] =
        React.useState<boolean>(false);
    // State that is specific to certain camera views
    const [predictiveDisplay, setPredictiveDisplay] =
        React.useState<boolean>(false);
    // Get the stream to display inside the video
    const stream: MediaStream = React.useMemo(
        () => getStream(definition.id, props.sharedState.remoteStreams),
        [definition],
    );

    React.useEffect(() => {
        executeVideoSettings(definition);
    }, [definition]);

    // Create the overlay
    const overlayDefinition = predictiveDisplay
        ? { type: ComponentType.PredictiveDisplay }
        : definition.children && definition.children.length > 0
          ? definition.children[0]
          : undefined;
    const videoAspectRatio = getVideoAspectRatio(definition);
    const overlay = createOverlay(
        overlayDefinition,
        props.path,
        props.sharedState,
        videoAspectRatio,
    );

    // Update the source of the video stream
    React.useEffect(() => {
        if (!videoRef?.current) return;
        videoRef.current.srcObject = stream;
    }, [stream]);

    const { customizing } = props.sharedState;
    const selected = isSelected(props);
    const videoClass = className("video-canvas", { customizing, selected });
    const realsense = props.definition.id === CameraViewId.realsense;
    const overhead = props.definition.id === CameraViewId.overhead;

    /** Mark this video stream as selected */
    function selectSelf() {
        props.sharedState.onSelect(props.definition, props.path);
        setContextMenuXY(null);
    }

    /** Mark the button pad child as selected */
    function selectChild() {
        props.sharedState.onSelect(overlayDefinition!, props.path + "-0");
        setContextMenuXY(null);
    }

    /** Opens a popup  */
    function handleClick(event: React.MouseEvent<HTMLDivElement>) {
        event.stopPropagation();

        // Get the coordinates of the click within the camera view
        const { clientX, clientY } = event;
        const { left, top, right, bottom } =
            videoRef.current!.getBoundingClientRect();
        const x = clientX - left;
        const y = clientY - top;

        console.log("CameraView clicked at x", x, "y ", y);

        // If you are customizing and there is a button pad on top of the
        // video feed, display a dropdown letting users to specify which to
        // select. Note that even clicks on overlaid components will trigger
        // this (in addition to the overlaid component's click event).
        if (customizing) {
            // If no button pad overlay then select self and return
            if (
                !overlayDefinition ||
                overlayDefinition.type !== ComponentType.ButtonPad
            ) {
                selectSelf();
                return;
            }

            // Create context menu popup where user can choose between selecting
            // the button pad or the video stream
            setContextMenuXY([x, y]);
        }
        // If it is the Realsense, there is no overlay (e.g., button pad),
        // and click-to-pregrasp is toggled on, select the goal.
        else if (
            props.definition.id === CameraViewId.realsense &&
            !overlay &&
            (props.definition as RealsenseVideoStreamDef)
                .selectObjectForMoveToPregrasp
        ) {
            let scaled_x = x / (right - left);
            let scaled_y = y / (bottom - top);
            setSelectObjectScaledXY([scaled_x, scaled_y]);
            console.log("scaled x", scaled_x, "scaled y", scaled_y);
            // underVideoFunctionProvider.provideFunctions(
            //   UnderVideoButton.MoveToPregrasp,
            // ).onClick!(scaled_x, scaled_y);add
        }
    }

    // Constrain the width or height when the stream gets too large
    React.useEffect(() => {
        const resizeObserver = new ResizeObserver((entries) => {
            // height and width of area around the video stream
            const { height, width } = entries[0].contentRect;
            const areaAspectRatio = +(width / height).toFixed(2);

            // height and width of video stream
            if (!videoRef?.current) return;
            const videoRect = videoRef.current.getBoundingClientRect();
            const videoAspectRatio = +(
                videoRect.width / videoRect.height
            ).toFixed(2);

            // Set whether the height or width is the constraining factor
            if (areaAspectRatio > videoAspectRatio) {
                setConstrainedHeight(true);
            } else if (areaAspectRatio < videoAspectRatio) {
                setConstrainedHeight(false);
            }

            // Set the font size for the selected object icon
            setSelectObjectFontSize((videoRect.width / 8).toString() + "px");
        });
        if (!videoAreaRef?.current) return;
        resizeObserver.observe(videoAreaRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const overlayContainer = (
        <div
            className={className("video-overlay-container", {
                customizing,
                selected,
                realsense,
                overhead,
                predictiveDisplay,
            })}
            // style={overlayDimensions}
            onClick={handleClick}
        >
            {
                // Display overlay on top of video stream
                overlay ? (
                    overlay
                ) : (
                    <DropZone
                        path={props.path + "-0"}
                        sharedState={props.sharedState}
                        parentDef={props.definition}
                    />
                )
            }
            {
                // When contextMenuXY is set, display thr context menu
                contextMenuXY ? (
                    <SelectContexMenu
                        clickXY={contextMenuXY}
                        selectSelf={selectSelf}
                        selectChild={selectChild}
                        clickOut={() => setContextMenuXY(null)}
                    />
                ) : undefined
            }
        </div>
    );
    // If the video is from the Realsense camera then include the pan-tilt
    // buttons around the video, otherwise return the video
    let videoOverlay = <></>;
    if (props.definition.id === CameraViewId.realsense) {
        videoOverlay = (
            <>
                <div
                    className={className("realsense-pan-tilt-grid", {
                        constrainedHeight,
                    })}
                >
                    {panTiltButtons.map((dir) => (
                        <PanTiltButton direction={dir} key={dir} />
                    ))}
                </div>
            </>
        );
    } else if (props.definition.id == CameraViewId.overhead) {
        videoOverlay = (
            <>
                {overlayDefinition?.type !== ComponentType.PredictiveDisplay &&
                !props.sharedState.hasBetaTeleopKit ? (
                    <div
                        className={className("realsense-pan-tilt-grid", {
                            constrainedHeight,
                        })}
                    >
                        {panTiltButtons.map((dir) => (
                            <PanTiltButton direction={dir} key={dir} />
                        ))}
                    </div>
                ) : (
                    <></>
                )}
            </>
        );
    }

    const videoComponent = (
        <div
            className="video-area"
            style={{ gridRow: 2, gridColumn: 1 }}
            ref={videoAreaRef}
        >
            {videoOverlay}
            <video
                ref={videoRef}
                autoPlay
                muted={true}
                className={className(videoClass, { constrainedHeight })}
            />
            {overlayContainer}
            {selectObjectScaledXY ? (
                <AddIcon
                    style={{
                        position: "absolute",
                        left: (selectObjectScaledXY[0] * 100).toString() + "%",
                        top: (selectObjectScaledXY[1] * 100).toString() + "%",
                        color: "red",
                        transform: "translateX(-50%) translateY(-50%)",
                    }}
                />
            ) : undefined}
        </div>
    );
    return (
        <div className="video-container" draggable={false}>
            {videoComponent}
            {definition.displayButtons ? (
                <div className="under-video-area" ref={underVideoAreaRef}>
                    <UnderVideoButtons
                        definition={definition}
                        setPredictiveDisplay={setPredictiveDisplay}
                        betaTeleopKit={props.sharedState.hasBetaTeleopKit}
                        selectObjectScaledXY={selectObjectScaledXY}
                        setSelectObjectScaledXY={setSelectObjectScaledXY}
                        isMovingToPregrasp={isMovingToPregrasp}
                        setIsMovingToPregrasp={setIsMovingToPregrasp}
                        isShowingTablet={isShowingTablet}
                        setIsShowingTablet={setIsShowingTablet}
                        underVideoAreaRef={underVideoAreaRef}
                        stretchTool={props.sharedState.stretchTool}
                    />
                </div>
            ) : (
                <></>
            )}
        </div>
    );
};

/**
 * Creates a single button for controlling the pan or tilt of the realsense camera
 *
 * @param props the direction of the button {@link PanTiltButton}
 */
const PanTiltButton = (props: { direction: ButtonPadButton }) => {
    let gridPosition: { gridRow: number; gridColumn: number }; // the position in the 3x3 grid around the video element
    let rotation: string; // how to rotate the arrow icon to point in the correct direction
    const functs = buttonFunctionProvider.provideFunctions(props.direction);

    // Specify button details based on the direction
    switch (props.direction) {
        case ButtonPadButton.CameraTiltUp:
            gridPosition = { gridRow: 1, gridColumn: 2 };
            rotation = "-90";
            break;
        case ButtonPadButton.CameraTiltDown:
            gridPosition = { gridRow: 3, gridColumn: 2 };
            rotation = "90";
            break;
        case ButtonPadButton.CameraPanLeft:
            gridPosition = { gridRow: 2, gridColumn: 1 };
            rotation = "180";
            break;
        case ButtonPadButton.CameraPanRight:
            gridPosition = { gridRow: 2, gridColumn: 3 };
            rotation = "0"; // by default the arrow icon points right
            break;
        default:
            throw Error(`unknown pan tilt button direction ${props.direction}`);
    }

    return (
        <button
            style={gridPosition}
            className={props.direction}
            onMouseDown={functs.onClick}
            onMouseUp={functs.onRelease}
            onMouseLeave={functs.onLeave}
        >
            <PlayCircleFilledIcon
                className="panTiltIcon"
                style={{ transform: `rotate(${rotation}deg)` }}
            />
        </button>
    );
};

/**
 * Creates a single button for controlling the pan or tilt of the realsense camera
 *
 * @param props the direction of the button {@link PanTiltButton}
 */
const PanTiltButtonOverlay = (props: { direction: ButtonPadButton }) => {
    const functs = buttonFunctionProvider.provideFunctions(props.direction);
    const dir = props.direction.split(" ")[2];
    let rotation: string;

    // Specify button details based on the direction
    switch (props.direction) {
        case ButtonPadButton.CameraTiltUp:
            rotation = "-90";
            break;
        case ButtonPadButton.CameraTiltDown:
            rotation = "90";
            break;
        case ButtonPadButton.CameraPanLeft:
            rotation = "180";
            break;
        case ButtonPadButton.CameraPanRight:
            rotation = "0"; // by default the arrow icon points right
            break;
        default:
            throw Error(`unknown pan tilt button direction ${props.direction}`);
    }

    return (
        <button
            className={"overlay btn-" + dir}
            onPointerDown={functs.onClick}
            onPointerUp={functs.onRelease}
            onPointerLeave={functs.onLeave}
        >
            {/* <img height={100} width={100} src={getIcon(props.direction)} className={ButtonState.Inactive} /> */}
            <span
                className="icon"
                style={{ transform: `rotate(${rotation}deg)` }}
            >
                arrow_right
            </span>
        </button>
    );
};

/******************************************************************************
 * Select context menu
 */

/** Props for {@link SelectContexMenu} */
type SelectContexMenuProps = {
    /** x and y location to render the context menu popup */
    clickXY: [number, number];
    /** Callback to select the video stream */
    selectSelf: () => void;
    /** Callback to select the child button pad */
    selectChild: () => void;
    /** Callback to hide the context menu popup when click outside */
    clickOut: () => void;
};

/**
 * Creates a context menu popup when user clicks during
 * customization mode so the user can choose between the button pad and its
 * parent video stream.
 *
 * @param props {@link SelectContexMenuProps}
 */
const SelectContexMenu = (props: SelectContexMenuProps) => {
    const ref = React.useRef<HTMLUListElement>(null);
    const [x, y] = props.clickXY;

    // Handler to close dropdown when click outside
    React.useEffect(() => {
        /** Closes context menu if user clicks outside */
        const handler = (e: any) => {
            // If didn't click inside the context menu or the existing SVG, then
            // hide the popup
            if (ref.current && !ref.current.contains(e.target)) {
                props.clickOut();
                console.log("clicked");
            }
        };
        window.addEventListener("click", handler, true);
        return () => {
            window.removeEventListener("click", handler);
        };
    }, []);

    /**
     * Handles when the user clicks on one of the context menu options
     * @param e mouse event of the click
     * @param self if true selects itself (a button pad), if false selects its
     * parent (the video stream)
     */
    function handleClick(e: React.MouseEvent<HTMLLIElement>, self: boolean) {
        self ? props.selectSelf() : props.selectChild();

        // Make sure background elements don't receive a click
        e.stopPropagation();
    }

    return (
        <ul
            aria-label="Select"
            ref={ref}
            className="video-context-menu"
            style={{ top: `${y}px`, left: `${x}px` }}
        >
            <li onClick={(e) => handleClick(e, false)}>Button Pad</li>
            <li onClick={(e) => handleClick(e, true)}>Video Stream</li>
        </ul>
    );
};

/*******************************************************************************
 * Helper functions
 */

/**
 * Get the aspect ratio of the video based on the definition
 *
 * @param definition definition of the video stream
 * @returns aspect ratio of the video stream
 */
function getVideoAspectRatio(definition: CameraViewDefinition): number {
    switch (definition.id) {
        case CameraViewId.gripper:
            return gripperProps.width / gripperProps.height;
        case CameraViewId.overhead:
            return navigationProps.width / navigationProps.height;
        case CameraViewId.realsense:
            return realsenseProps.width / realsenseProps.height;
        default:
            throw Error(`undefined aspect ratio for ${definition.type}`);
    }
}

/**
 * Creates an overlay element for the video stream
 *
 * @param overlayDefinition definition for the component to overlay on the video stream
 * @param path path to the parent video stream component
 * @param sharedState {@link SharedState}
 * @returns overlay element, or undefined if video stream doesn't have an overlay
 */
function createOverlay(
    overlayDefinition: ComponentDefinition | undefined,
    path: string,
    sharedState: SharedState,
    aspectRatio: number,
): JSX.Element | undefined {
    // If overlay definition is undefined then there's no overlay for this stream
    if (!overlayDefinition) return undefined;
    if (!overlayDefinition.type) {
        console.warn(
            `Video stream at path ${path} has child with undefined type:`,
        );
        console.warn(overlayDefinition);
        return undefined;
    }

    const overlayProps = {
        definition: overlayDefinition,
        path: path + "-0",
        sharedState: sharedState,
    } as CustomizableComponentProps;

    switch (overlayDefinition.type) {
        case ComponentType.ButtonPad:
            return (
                <ButtonPad
                    {...overlayProps}
                    overlay
                    aspectRatio={aspectRatio}
                />
            );
        case ComponentType.PredictiveDisplay:
            return <PredictiveDisplay {...overlayProps} />;
        default:
            throw Error(
                "Video stream at path " +
                    path +
                    " cannot overlay child of type" +
                    overlayDefinition.type,
            );
    }
}

/**
 * Gets the stream based on the identifier
 *
 * @param id identifier for the video stream
 * @param remoteStreams map of {@link RemoteStream}
 * @returns the corresponding stream
 */
function getStream(
    id: CameraViewId,
    remoteStreams: Map<string, RemoteStream>,
): MediaStream {
    let streamName: string;
    switch (id) {
        case CameraViewId.overhead:
            streamName = "overhead";
            break;
        case CameraViewId.realsense:
            streamName = "realsense";
            break;
        case CameraViewId.gripper:
            streamName = "gripper";
            break;
        default:
            throw Error(`unknown video stream id: ${id}`);
    }
    return remoteStreams.get(streamName)!.stream;
}

/**
 * Executes any functions required when this video stream is rendered. This might
 * be changing the view cropping for the overhead camera, hiding the depth sensing
 * for the Realsense, etc.
 *
 * @param definition {@link CameraViewDefinition}
 */
function executeVideoSettings(definition: CameraViewDefinition) {
    switch (definition.id) {
        case CameraViewId.gripper:
            executeGripperSettings(definition as GripperVideoStreamDef);
            break;
        case CameraViewId.overhead:
            // executeFixedOverheadSettings(definition as FixedOverheadVideoStreamDef);
            executeAdjustableOverheadettings(
                definition as AdjustableOverheadVideoStreamDef,
            );
            break;
        case CameraViewId.realsense:
            executeRealsenseSettings(definition as RealsenseVideoStreamDef);
            break;
        default:
            throw Error(`unknow video stream id: ${definition.id}`);
    }
}

/**
 * Executes functions to prepare for rendering the overhead video stream.
 *
 * @param definition {@link FixedOverheadVideoStreamDef}
 */
function executeFixedOverheadSettings(definition: FixedOverheadVideoStreamDef) {
    const overheadViewButton = definition.gripperView
        ? UnderVideoButton.GripperView
        : UnderVideoButton.DriveView;
    underVideoFunctionProvider.provideFunctions(overheadViewButton).onClick!();
}

/**
 * Executes functions to prepare for rendering the Realsense video stream.
 *
 * @param definition {@link AdjustableOverheadVideoStreamDef}
 */
function executeAdjustableOverheadettings(
    definition: AdjustableOverheadVideoStreamDef,
) {
    underVideoFunctionProvider.provideFunctions(UnderVideoButton.FollowGripper)
        .onCheck!(definition.followGripper || false);
}

/**
 * Executes functions to prepare for rendering the Realsense video stream.
 *
 * @param definition {@link RealsenseVideoStreamDef}
 */
function executeRealsenseSettings(definition: RealsenseVideoStreamDef) {
    underVideoFunctionProvider.provideFunctions(UnderVideoButton.FollowGripper)
        .onCheck!(definition.followGripper || false);
    underVideoFunctionProvider.provideFunctions(
        UnderVideoButton.RealsenseDepthSensing,
    ).onCheck!(definition.depthSensing || false);
    underVideoFunctionProvider.provideFunctions(
        UnderVideoButton.RealsenseBodyPoseEstimate,
    ).onCheck!(definition.bodyPoseAR || false);
}

/**
 * Executes functions to prepare for rendering the Gripper video stream.
 *
 * @param definition {@link GripperVideoStreamDef}
 */
function executeGripperSettings(definition: GripperVideoStreamDef) {
    underVideoFunctionProvider.provideFunctions(
        UnderVideoButton.GripperDepthSensing,
    ).onCheck!(definition.depthSensing || false);
    underVideoFunctionProvider.provideFunctions(
        UnderVideoButton.ExpandedGripperView,
    ).onCheck!(definition.expandedGripperView || false);
}

/*******************************************************************************
 * Under Video Buttons
 */

/**
 * Buttons to display under a video stream (e.g. toggle cropping of overhead
 * stream, display depth sensing on Realsense, etc.)
 */
const UnderVideoButtons = (props: {
    definition: CameraViewDefinition;
    setPredictiveDisplay: (enabled: boolean) => void;
    selectObjectScaledXY: [number, number] | null;
    setSelectObjectScaledXY: (scaledXY: [number, number] | null) => void;
    isMovingToPregrasp: boolean;
    setIsMovingToPregrasp: (isMoving: boolean) => void;
    isShowingTablet: boolean;
    setIsShowingTablet: (isShowing: boolean) => void;
    underVideoAreaRef: React.RefObject<HTMLDivElement>;
    betaTeleopKit: boolean;
    stretchTool: StretchTool;
}) => {
    let buttons: JSX.Element | null;
    switch (props.definition.id) {
        case CameraViewId.gripper:
            buttons = (
                <UnderGripperButtons
                    definition={props.definition}
                    betaTeleopKit={props.betaTeleopKit}
                    stretchTool={props.stretchTool}
                />
            );
            break;
        case CameraViewId.overhead:
            buttons = hasBetaTeleopKit ? (
                <UnderOverheadButtons
                    definition={props.definition}
                    setPredictiveDisplay={props.setPredictiveDisplay}
                />
            ) : (
                <UnderAdjustableOverheadButtons
                    definition={props.definition}
                    setPredictiveDisplay={props.setPredictiveDisplay}
                    stretchTool={props.stretchTool}
                />
            );
            break;
        case CameraViewId.realsense:
            buttons = (
                <UnderRealsenseButtons
                    definition={props.definition}
                    selectObjectScaledXY={props.selectObjectScaledXY}
                    setSelectObjectScaledXY={props.setSelectObjectScaledXY}
                    isMovingToPregrasp={props.isMovingToPregrasp}
                    setIsMovingToPregrasp={props.setIsMovingToPregrasp}
                    isShowingTablet={props.isShowingTablet}
                    setIsShowingTablet={props.setIsShowingTablet}
                    underVideoAreaRef={props.underVideoAreaRef}
                    stretchTool={props.stretchTool}
                />
            );
            break;
        default:
            throw Error(`unknow video stream id: ${props.definition.id}`);
    }
    return buttons;
};

/**
 * Buttons to display under the overhead video stream.
 */
const UnderOverheadButtons = (props: {
    definition: FixedOverheadVideoStreamDef;
    setPredictiveDisplay: (enabled: boolean) => void;
}) => {
    const [rerender, setRerender] = React.useState<boolean>(false);

    return (
        <React.Fragment>
            <CheckToggleButton
                checked={props.definition.predictiveDisplay || false}
                onClick={() => {
                    if (!props.definition.predictiveDisplay) {
                        props.definition.predictiveDisplay = true;
                        props.setPredictiveDisplay(true);
                    } else {
                        props.definition.predictiveDisplay = false;
                        props.setPredictiveDisplay(false);
                    }
                    setRerender(!rerender);
                }}
                label="Predictive Display"
            />
        </React.Fragment>
    );
};

/**
 * Buttons to display under the adjustable overhead video stream.
 */
const UnderAdjustableOverheadButtons = (props: {
    definition: AdjustableOverheadVideoStreamDef;
    setPredictiveDisplay: (enabled: boolean) => void;
    stretchTool: StretchTool;
}) => {
    const [rerender, setRerender] = React.useState<boolean>(false);

    return (
        <React.Fragment>
            <AccordionSelect
                title="Look..."
                possibleOptions={realsenseButtons.map((button) => {
                    if (button === UnderVideoButton.LookAtGripper) {
                        return "Look at " + getGripperLabel(props.stretchTool);
                    }
                    return button;
                })}
                onChange={(idx: number) => {
                    underVideoFunctionProvider.provideFunctions(
                        realsenseButtons[idx],
                    ).onClick!();
                }}
            />
            <CheckToggleButton
                checked={props.definition.followGripper || false}
                onClick={() => {
                    props.definition.followGripper =
                        !props.definition.followGripper;
                    setRerender(!rerender);
                    underVideoFunctionProvider.provideFunctions(
                        UnderVideoButton.FollowGripper,
                    ).onCheck!(props.definition.followGripper);
                }}
                label={"Follow " + getGripperLabel(props.stretchTool)}
            />
            <CheckToggleButton
                checked={props.definition.predictiveDisplay || false}
                onClick={() => {
                    if (!props.definition.predictiveDisplay) {
                        underVideoFunctionProvider.provideFunctions(
                            UnderVideoButton.LookAtBase,
                        ).onClick!();
                        props.setPredictiveDisplay(true);
                        props.definition.predictiveDisplay = true;
                    } else {
                        props.setPredictiveDisplay(false);
                        props.definition.predictiveDisplay = false;
                    }
                    setRerender(!rerender);
                }}
                label="Predictive Display"
            />
        </React.Fragment>
    );
};

/**
 * Buttons to display under the Realsense video stream.
 */
const UnderRealsenseButtons = (props: {
    definition: RealsenseVideoStreamDef;
    selectObjectScaledXY: [number, number] | null;
    setSelectObjectScaledXY: (scaledXY: [number, number] | null) => void;
    isMovingToPregrasp: boolean;
    setIsMovingToPregrasp: (isMoving: boolean) => void;
    isShowingTablet: boolean;
    setIsShowingTablet: (isShowing: boolean) => void;
    underVideoAreaRef: React.RefObject<HTMLDivElement>;
    stretchTool: StretchTool;
}) => {
    const [rerender, setRerender] = React.useState<boolean>(false);
    const [selectedIdx, setSelectedIdx] = React.useState<number>();
    // const [markers, setMarkers] = React.useState<string[]>(['light_switch'])

    console.log(
        "UnderRealsenseButtons",
        props.isMovingToPregrasp,
        props.isShowingTablet,
    );

    // Only show MoveToPregrasp buttons if the robot has a Dex wrist with a gripper
    let moveToPregraspButtons = <></>;
    if (props.stretchTool === StretchTool.DEX_GRIPPER) {
        moveToPregraspButtons = (
            <React.Fragment>
                <CheckToggleButton
                    checked={
                        props.definition.selectObjectForMoveToPregrasp || false
                    }
                    onClick={() => {
                        props.definition.selectObjectForMoveToPregrasp =
                            !props.definition.selectObjectForMoveToPregrasp;
                        props.setSelectObjectScaledXY(null);
                        setRerender(!rerender);
                    }}
                    label="Select Object"
                />
                {props.isMovingToPregrasp ? (
                    <button
                        className="map-cancel-btn"
                        onPointerDown={() => {
                            underVideoFunctionProvider.provideFunctions(
                                UnderVideoButton.CancelMoveToPregrasp,
                            ).onClick!();
                            props.setIsMovingToPregrasp(false);
                        }}
                    >
                        <span>Cancel</span>
                        <CancelIcon />
                    </button>
                ) : (
                    <AccordionSelect
                        title="Align Gripper to Object"
                        possibleOptions={Object.values(
                            realsenseMoveToPregraspButtons,
                        )}
                        backgroundColor="var(--selected-color)"
                        onChange={(idx: number) => {
                            if (props.selectObjectScaledXY == null) {
                                underVideoFunctionProvider.setMoveToPregraspState(
                                    {
                                        state: "Please select an object first.",
                                        alert_type: "error",
                                    },
                                );
                                return;
                            }
                            underVideoFunctionProvider.provideFunctions(
                                realsenseMoveToPregraspButtons[idx],
                            ).onClick!(props.selectObjectScaledXY);
                            props.setSelectObjectScaledXY(null);
                            props.setIsMovingToPregrasp(true);
                            props.definition.selectObjectForMoveToPregrasp =
                                false;
                            underVideoFunctionProvider.provideFunctions(
                                UnderVideoButton.MoveToPregraspGoalReached,
                            ).getFuture!().then(() => {
                                props.setIsMovingToPregrasp(false);
                            });
                        }}
                        toggleAccordianCallback={() => {
                            if (props.underVideoAreaRef.current) {
                                // Over the next 600ms, which is the CSS-specified transition time for
                                // an accordion, keep scrolling the underVideoArea to the bottom, in case
                                // the expanded accordion is off-screen.
                                let startTime = Date.now();
                                let scrollInterval = setInterval(() => {
                                    let currentTime = Date.now();
                                    let timeElapsed = currentTime - startTime;
                                    if (timeElapsed >= 600) {
                                        clearInterval(scrollInterval);
                                    } else {
                                        props.underVideoAreaRef.current!.scrollTop =
                                            props.underVideoAreaRef.current!.scrollHeight;
                                    }
                                }, 10);
                            }
                        }}
                    />
                )}
            </React.Fragment>
        );
    }

    // Only show ShowTablet buttons if the robot has a tablet attached.
    let showTabletButtons = <></>;
    if (props.stretchTool === StretchTool.TABLET) {
        showTabletButtons = (
            <React.Fragment>
                <CheckToggleButton
                    checked={props.definition.bodyPoseAR || false}
                    onClick={() => {
                        props.definition.bodyPoseAR =
                            !props.definition.bodyPoseAR;
                        setRerender(!rerender);
                        underVideoFunctionProvider.provideFunctions(
                            UnderVideoButton.RealsenseBodyPoseEstimate,
                        ).onCheck!(props.definition.bodyPoseAR);
                    }}
                    label="Show Body Pose"
                />
                {props.definition.bodyPoseAR &&
                    (props.isShowingTablet ? (
                        <button
                            className="map-cancel-btn"
                            onPointerDown={() => {
                                underVideoFunctionProvider.provideFunctions(
                                    UnderVideoButton.RealsenseStopShowTablet,
                                ).onClick!();
                                props.setIsShowingTablet(false);
                            }}
                        >
                            <span>Cancel</span>
                            <CancelIcon />
                        </button>
                    ) : (
                        <button
                            className="map-play-btn"
                            onPointerDown={() => {
                                underVideoFunctionProvider.provideFunctions(
                                    UnderVideoButton.RealsenseShowTablet,
                                ).onClick!();
                                props.setIsShowingTablet(true);
                                underVideoFunctionProvider.provideFunctions(
                                    UnderVideoButton.RealsenseShowTabletGoalReached,
                                ).getFuture!().then(() => {
                                    props.setIsShowingTablet(false);
                                });
                            }}
                        >
                            <span>Show Tablet</span>
                            <PlayCircle />
                        </button>
                    ))}
            </React.Fragment>
        );
    }

    return (
        <React.Fragment>
            <AccordionSelect
                title="Look..."
                possibleOptions={realsenseButtons.map((button) => {
                    if (button === UnderVideoButton.LookAtGripper) {
                        return "Look at " + getGripperLabel(props.stretchTool);
                    }
                    return button;
                })}
                onChange={(idx: number) => {
                    underVideoFunctionProvider.provideFunctions(
                        realsenseButtons[idx],
                    ).onClick!();
                }}
            />
            <CheckToggleButton
                checked={props.definition.followGripper || false}
                onClick={() => {
                    props.definition.followGripper =
                        !props.definition.followGripper;
                    setRerender(!rerender);
                    underVideoFunctionProvider.provideFunctions(
                        UnderVideoButton.FollowGripper,
                    ).onCheck!(props.definition.followGripper);
                }}
                label={"Follow " + getGripperLabel(props.stretchTool)}
            />
            <CheckToggleButton
                checked={props.definition.depthSensing || false}
                onClick={() => {
                    props.definition.depthSensing =
                        !props.definition.depthSensing;
                    setRerender(!rerender);
                    underVideoFunctionProvider.provideFunctions(
                        UnderVideoButton.RealsenseDepthSensing,
                    ).onCheck!(props.definition.depthSensing);
                }}
                label="Depth Sensing"
            />
            {moveToPregraspButtons}
            {showTabletButtons}
            {/* <CheckToggleButton
                checked={props.definition.arucoMarkers || false}
                onClick={() => {
                    props.definition.arucoMarkers = !props.definition.arucoMarkers;
                    setRerender(!rerender);
                    underVideoFunctionProvider.provideFunctions(UnderVideoButton.ToggleArucoMarkers).onCheck!(props.definition.arucoMarkers)
                }}
                label="Aruco Markers"
            /> */}
            {/* <Dropdown
                onChange={setSelectedIdx}
                selectedIndex={selectedIdx}
                possibleOptions={markers}
                placeholderText="Select a marker..."
                top={true}
            />
            <button className="play-btn" onClick={
                () => {
                    if (selectedIdx != undefined) {
                        let marker_name = markers[selectedIdx]
                        underVideoFunctionProvider.provideFunctions(UnderVideoButton.NavigateToMarker).send!(marker_name)
                    }
                }
            }>
                Play
                <span className="material-icons">
                    play_circle
                </span>
            </button> */}
        </React.Fragment>
    );
};

/**
 * Buttons to display under the gripper video stream.
 */
const UnderGripperButtons = (props: {
    definition: GripperVideoStreamDef;
    betaTeleopKit: boolean;
    stretchTool: StretchTool;
}) => {
    let tabletOrientation = underVideoFunctionProvider.provideFunctions(
        UnderVideoButton.GetTabletOrientation,
    ).get!();
    const [rerender, setRerender] = React.useState<boolean>(false);

    return (
        <React.Fragment>
            <AccordionSelect
                title="Quick Actions..."
                possibleOptions={Object.values(wristButtons)}
                onChange={(idx: number) => {
                    underVideoFunctionProvider.provideFunctions(
                        wristButtons[idx],
                    ).onClick!();
                }}
            />
            {props.betaTeleopKit ? (
                <></>
            ) : (
                <React.Fragment>
                    <CheckToggleButton
                        checked={props.definition.expandedGripperView || false}
                        onClick={() => {
                            props.definition.expandedGripperView =
                                !props.definition.expandedGripperView;
                            setRerender(!rerender);
                            underVideoFunctionProvider.provideFunctions(
                                UnderVideoButton.ExpandedGripperView,
                            ).onCheck!(props.definition.expandedGripperView!);
                        }}
                        label="Expanded Gripper View"
                    />
                    {(props.stretchTool === StretchTool.GRIPPER ||
                        props.stretchTool === StretchTool.DEX_GRIPPER) && (
                        <CheckToggleButton
                            checked={props.definition.depthSensing || false}
                            onClick={() => {
                                props.definition.depthSensing =
                                    !props.definition.depthSensing;
                                setRerender(!rerender);
                                underVideoFunctionProvider.provideFunctions(
                                    UnderVideoButton.GripperDepthSensing,
                                ).onCheck!(props.definition.depthSensing);
                            }}
                            label="Depth Sensing"
                        />
                    )}
                </React.Fragment>
            )}
            {props.stretchTool === StretchTool.TABLET && (
                <button
                    onClick={() => {
                        let isPortait =
                            tabletOrientation === TabletOrientation.PORTRAIT;
                        underVideoFunctionProvider.provideFunctions(
                            UnderVideoButton.ToggleTabletOrientation,
                        ).onCheck!(isPortait);
                        setRerender(!rerender);
                    }}
                >
                    Switch to{" "}
                    {tabletOrientation === TabletOrientation.PORTRAIT
                        ? "Landscape"
                        : "Portrait"}{" "}
                    View
                </button>
            )}
        </React.Fragment>
    );
};

/**
 * Button to change the camera perspective for a given video stream.
 */
const CameraPerspectiveButton = (props: {
    /**
     * When the button is clicked, the corresponding video stream should change
     * to this perspective.
     */
    perspective: OverheadButtons | RealsenseButtons;
}) => {
    const onClick = underVideoFunctionProvider.provideFunctions(
        props.perspective,
    ).onClick;
    return <button onClick={onClick}>{props.perspective}</button>;
};

function getGripperLabel(stretchTool: StretchTool) {
    switch (stretchTool) {
        case StretchTool.TABLET:
            return "Tablet";
        case StretchTool.GRIPPER:
        case StretchTool.DEX_GRIPPER:
            return "Gripper";
        default:
            return "Wrist";
    }
}
