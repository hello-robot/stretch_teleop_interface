import React, { useEffect } from "react";
import "latest-createjs";
import {
    CustomizableComponentProps,
    isSelected,
} from "./CustomizableComponent";
import { MapDefinition } from "../utils/component_definitions";
import { mapFunctionProvider, occupancyGrid } from "operator/tsx/index";
import "operator/css/Map.css";
import { Canvas } from "../static_components/Canvas";
import { OccupancyGrid } from "../static_components/OccupancyGrid";
import {
    AMCLPose,
    ROSOccupancyGrid,
    ROSPose,
    className,
    waitUntil,
} from "shared/util";
import ROSLIB from "roslib";
import { UnderMapButton } from "../function_providers/UnderMapFunctionProvider";
import { underMapFunctionProvider } from "operator/tsx/index";
import { CheckToggleButton } from "../basic_components/CheckToggleButton";
import { useState } from "react";
import { Dropdown } from "../basic_components/Dropdown";
import { PopupModal } from "../basic_components/PopupModal";
import { Tooltip } from "operator/tsx/static_components/Tooltip";
import { isMobile } from "react-device-detect";
import { RadioFunctions, RadioGroup } from "../basic_components/RadioGroup";
import PlayCircle from "@mui/icons-material/PlayCircle";
import Save from "@mui/icons-material/Save";
import Cancel from "@mui/icons-material/Cancel";

export enum MapFunction {
    GetMap,
    GetPose,
    MoveBase,
    GoalReached,
}

export interface MapFunctions {
    GetMap: ROSOccupancyGrid;
    GetPose: () => ROSLIB.Transform;
    MoveBase: (pose: ROSPose) => void;
    GoalReached: () => boolean;
    SelectGoal: () => boolean;
    SetSelectGoal: (selectGoal: boolean) => void;
}

export interface UnderMapFunctions {
    SelectGoal: (toggle: boolean) => void;
    CancelGoal: () => void;
    DeleteGoal: (goalId: number) => void;
    SaveGoal: (name: string) => void;
    LoadGoal: (goalID: number) => void;
    GetPose: () => ROSLIB.Transform;
    GetSavedPoseNames: () => string[];
    GetSavedPoseTypes: () => string[];
    GetSavedPoses: () => ROSLIB.Transform[];
    DisplayPoseMarkers: (
        toggle: boolean,
        poses: ROSLIB.Transform[],
        poseNames: string[],
        poseTypes: string[],
    ) => void;
    DisplayGoalMarker: (pose: ROSLIB.Vector3) => void;
    NavigateToAruco: (goalID: number) => void;
    Play: () => void;
    RemoveGoalMarker: () => void;
    GoalReached: () => Promise<boolean>;
}

export const Map = (props: CustomizableComponentProps) => {
    const definition = props.definition as MapDefinition;
    const [active, setActive] = React.useState<boolean>(false);
    const [occupancyGrid, setOccupanyGrid] = React.useState<OccupancyGrid>();
    const [selectGoal, setSelectGoal] = React.useState<boolean>(false);
    const { customizing, hideLabels } = props.sharedState;
    const selected = isSelected(props);

    // Constrain the width or height when the stream gets too large
    React.useEffect(() => {
        let map = mapFn.GetMap;
        let width = map ? map.info.width : 60;
        let height = map ? map.info.height : 100;
        var canvas = new Canvas({
            divID: "map",
            className: "mapCanvas",
            width: width * 5, // Scale width to avoid blurriness when making map larger
            height: height * 5, // Scale height to avoid blurriness when making map larger
        });
        var occupancyGridMap = new OccupancyGrid({
            functs: mapFn,
            rootObject: canvas.scene!,
        });
        canvas.scaleToDimensions(
            occupancyGridMap.width,
            occupancyGridMap.height,
        );
        setOccupanyGrid(occupancyGridMap);
    }, []);

    function handleSelect(event: React.MouseEvent<HTMLDivElement>) {
        event.stopPropagation();
        props.sharedState.onSelect(props.definition, props.path);
    }

    const handleSelectGoal = React.useCallback((selectGoal: boolean) => {
        setSelectGoal(selectGoal);
        mapFn.SelectGoal = (): boolean => {
            return selectGoal;
        };
    }, []);
    
    let mapFn: MapFunctions = {
        GetMap: mapFunctionProvider.provideFunctions(
            MapFunction.GetMap,
        ) as ROSOccupancyGrid,
        GetPose: mapFunctionProvider.provideFunctions(
            MapFunction.GetPose,
        ) as () => ROSLIB.Transform,
        MoveBase: mapFunctionProvider.provideFunctions(
            MapFunction.MoveBase,
        ) as (pose: ROSPose) => void,
        GoalReached: mapFunctionProvider.provideFunctions(
            MapFunction.GoalReached,
        ) as () => boolean,
        SelectGoal: (): boolean => {
            return selectGoal;
        },
        SetSelectGoal: (selectGoal: boolean) => {
            handleSelectGoal(selectGoal);
        },
    };

    let underMapFn: UnderMapFunctions = {
        SelectGoal: underMapFunctionProvider.provideFunctions(
            UnderMapButton.SelectGoal,
        ) as () => void,
        CancelGoal: underMapFunctionProvider.provideFunctions(
            UnderMapButton.CancelGoal,
        ) as () => void,
        DeleteGoal: underMapFunctionProvider.provideFunctions(
            UnderMapButton.DeleteGoal,
        ) as (goalID: number) => void,
        SaveGoal: underMapFunctionProvider.provideFunctions(
            UnderMapButton.SaveGoal,
        ) as (name: string) => void,
        LoadGoal: underMapFunctionProvider.provideFunctions(
            UnderMapButton.LoadGoal,
        ) as () => void,
        GetPose: underMapFunctionProvider.provideFunctions(
            UnderMapButton.GetPose,
        ) as () => ROSLIB.Transform,
        GetSavedPoseNames: underMapFunctionProvider.provideFunctions(
            UnderMapButton.GetSavedPoseNames,
        ) as () => string[],
        GetSavedPoseTypes: underMapFunctionProvider.provideFunctions(
            UnderMapButton.GetSavedPoseTypes,
        ) as () => string[],
        GetSavedPoses: underMapFunctionProvider.provideFunctions(
            UnderMapButton.GetSavedPoses,
        ) as () => ROSLIB.Transform[],
        DisplayPoseMarkers: (
            toggle: boolean,
            poses: ROSLIB.Transform[],
            poseNames: string[],
            poseTypes: string[],
        ) => {
            return occupancyGrid!.displayPoseMarkers(
                toggle,
                poses,
                poseNames,
                poseTypes,
            );
        },
        DisplayGoalMarker: (pose: ROSLIB.Vector3) =>
            occupancyGrid!.createGoalMarker(pose.x, pose.y, true),
        NavigateToAruco: underMapFunctionProvider.provideFunctions(
            UnderMapButton.NavigateToAruco,
        ) as (goalID: number) => void,
        Play: () => occupancyGrid!.play(),
        RemoveGoalMarker: () => occupancyGrid!.removeGoalMarker(),
        GoalReached: underMapFunctionProvider.provideFunctions(
            UnderMapButton.GoalReached,
        ) as () => Promise<boolean>,
    };

    return (
        <React.Fragment>
            <div
                className={isMobile ? "mobile-map-container" : "map-container"}
            >
                {!isMobile ? <h4 className="map-title">Map</h4> : <></>}
                <div
                    id="map"
                    className={className("map", {
                        customizing,
                        selected,
                        active,
                    })}
                    onClick={handleSelect}
                ></div>
                {
                    !isMobile && (
                        // <div className={"under-video-area"}>
                        <UnderMapButtons
                            handleSelectGoal={handleSelectGoal}
                            functs={underMapFn}
                            hideLabels={hideLabels}
                        />
                    )
                    // </div>
                }
            </div>
            {isMobile && (
                <UnderMapButtons
                    handleSelectGoal={handleSelectGoal}
                    functs={underMapFn}
                    hideLabels={hideLabels}
                />
            )}
        </React.Fragment>
    );
};

/**
 * Buttons to display under the map.
 */
const UnderMapButtons = (props: {
    handleSelectGoal: (selectGoal: boolean) => void;
    functs: UnderMapFunctions;
    hideLabels?: boolean;
}) => {
    const [poses, setPoses] = useState<string[]>(
        props.functs.GetSavedPoseNames(),
    );
    const [selectedIdx, setSelectedIdx] = React.useState<number>();
    const [selectGoal, setSelectGoal] = React.useState<boolean>(false);
    const [displayGoals, setDisplayGoals] = React.useState<boolean>(false);
    const [showSavePoseModal, setShowSavePoseModal] = useState<boolean>(false);
    const [play, setPlay] = useState<boolean>(false);

    let radioFuncts: RadioFunctions = {
        Delete: (label: string) =>
            props.functs.DeleteGoal(
                props.functs.GetSavedPoseNames().indexOf(label),
            ),
        GetLabels: () => props.functs.GetSavedPoseNames(),
        SelectedLabel: (label: string) =>
            setSelectedIdx(props.functs.GetSavedPoseNames().indexOf(label)),
    };

    const SavePoseModal = (props: {
        functs: UnderMapFunctions;
        setShow: (show: boolean) => void;
        show: boolean;
    }) => {
        const [name, setName] = React.useState<string>("");
        function handleAccept() {
            if (name.length > 0) {
                if (!poses.includes(name)) {
                    setPoses((poses) => [...poses, name]);
                }
                props.functs.SaveGoal(name);
                props.functs.DisplayPoseMarkers(
                    displayGoals,
                    props.functs.GetSavedPoses(),
                    props.functs.GetSavedPoseNames(),
                    props.functs.GetSavedPoseTypes(),
                );
            }
            setName("");
        }

        return (
            <PopupModal
                setShow={props.setShow}
                show={props.show}
                onAccept={handleAccept}
                id="save-pose-modal"
                acceptButtonText="Save"
                acceptDisabled={name.length < 1}
                size={isMobile ? "small" : "large"}
                mobile={isMobile}
            >
                {/* <label htmlFor="new-pose-name"><b>Save Current Pose on Map</b></label>
                <hr /> */}
                <div
                    className={"pose-name" + isMobile ? "mobile-pose-name" : ""}
                >
                    {/* <label>Pose Name</label> */}
                    <input
                        autoFocus
                        type="text"
                        id="new-pose-name"
                        name="new-option-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter name of destination"
                    />
                </div>
            </PopupModal>
        );
    };

    function formatNamesandTypes(
        names: string[],
        types: string[],
    ): React.JSX.Element[] {
        let elements: React.JSX.Element[] = [];
        names.map((name, index) => {
            elements.push(
                <p>
                    <em>{types[index]}</em> {name}
                </p>,
            );
        });
        return elements;
    }

    return !isMobile ? (
        <React.Fragment>
            <div className="map-fn-btns">
                <CheckToggleButton
                    checked={selectGoal}
                    onClick={() => {
                        props.handleSelectGoal(!selectGoal);
                        setSelectGoal(!selectGoal);
                        if (selectGoal) props.functs.RemoveGoalMarker();
                        else radioFuncts.SelectedLabel(undefined);
                    }}
                    label="Select Goal"
                />
                {!play && (
                    <button
                        className="map-play-btn"
                        onPointerDown={() => {
                            if (!play && selectGoal) {
                                props.functs.Play();
                                setPlay(true);
                                setSelectGoal(false);
                                props.functs
                                    .GoalReached()
                                    .then((goalReached) => setPlay(false));
                            } else if (!play && selectedIdx != undefined) {
                                let pose: ROSLIB.Vector3 =
                                    props.functs.LoadGoal(selectedIdx)!;
                                props.functs.DisplayGoalMarker(pose);
                                props.functs.NavigateToAruco(selectedIdx);
                                setPlay(true);
                                setSelectGoal(false);
                                props.functs
                                    .GoalReached()
                                    .then((goalReached) => setPlay(false));
                            }
                        }}
                    >
                        <span>Start</span>
                        <PlayCircle />
                    </button>
                )}
                {play && (
                    <button
                        className="map-cancel-btn"
                        onPointerDown={() => {
                            props.functs.CancelGoal();
                            setPlay(!play);
                        }}
                    >
                        <span>Cancel</span>
                        <Cancel/>
                    </button>
                )}
                <button
                    className="map-save-btn"
                    onPointerDown={() => {
                        setShowSavePoseModal(true);
                        // Disable select goal to stop accidental navigation
                        if (selectGoal) {
                            props.handleSelectGoal(false);
                            setSelectGoal(false);
                        }
                    }}
                >
                    <span hidden={props.hideLabels}>Save new destination</span>
                    <Save/>
                </button>
            </div>
            <RadioGroup functs={radioFuncts} />
            <SavePoseModal
                functs={props.functs}
                setShow={setShowSavePoseModal}
                show={showSavePoseModal}
            />
        </React.Fragment>
    ) : (
        <React.Fragment>
            <RadioGroup functs={radioFuncts} />
            <div className="map-fn-btns-mobile">
                <div
                    className="mobile-map-save-btn"
                    onPointerDown={() => {
                        setShowSavePoseModal(true);
                        // Disable select goal to stop accidental navigation
                        if (selectGoal) {
                            props.handleSelectGoal(false);
                            setSelectGoal(false);
                        }
                    }}
                >
                    <span hidden={props.hideLabels}>Save new destination</span>
                    <span className="material-icons">save</span>
                </div>
                {!play && (
                    <div
                        className="mobile-map-play-btn"
                        onPointerDown={() => {
                            if (!play && selectGoal) {
                                props.functs.Play();
                                setPlay(true);
                                setSelectGoal(false);
                                props.functs
                                    .GoalReached()
                                    .then((goalReached) => setPlay(false));
                            } else if (!play && selectedIdx != undefined) {
                                let pose: ROSLIB.Vector3 =
                                    props.functs.LoadGoal(selectedIdx)!;
                                props.functs.DisplayGoalMarker(pose);
                                props.functs.NavigateToAruco(selectedIdx);
                                setPlay(true);
                                setSelectGoal(false);
                                props.functs
                                    .GoalReached()
                                    .then((goalReached) => setPlay(false));
                            }
                        }}
                    >
                        <span>Play</span>
                        <span className="material-icons">play_circle</span>
                    </div>
                )}
                {play && (
                    <div
                        className="mobile-map-cancel-btn"
                        onPointerDown={() => {
                            props.functs.CancelGoal();
                            setPlay(!play);
                        }}
                    >
                        <span>Cancel</span>
                        <span className="material-icons">cancel</span>
                    </div>
                )}
                <CheckToggleButton
                    checked={selectGoal}
                    onClick={() => {
                        props.handleSelectGoal(!selectGoal);
                        setSelectGoal(!selectGoal);
                    }}
                    label="Select Goal"
                />
            </div>
            <SavePoseModal
                functs={props.functs}
                setShow={setShowSavePoseModal}
                show={showSavePoseModal}
            />
        </React.Fragment>
    );
};
