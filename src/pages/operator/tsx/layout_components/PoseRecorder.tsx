import React, { useState } from "react";
import { PopupModal } from "../basic_components/PopupModal";
import { poseRecorderFunctionProvider } from "operator/tsx/index";
import { Dropdown } from "../basic_components/Dropdown";
import "operator/css/PoseRecorder.css"
import "operator/css/basic_components.css"

/** All the possible button functions */
export enum PoseRecorderFunction {
    Record,
    SaveRecording,
    SavedRecordingNames, 
    DeleteRecording,
    LoadRecording
}

export interface PoseRecorderFunctions {
    Record: () => void
    SaveRecording: (name: string) => void,
    SavedRecordingNames: () => string[],
    DeleteRecording: (recordingID: number) => void,
    LoadRecording: (recordingID: number) => void
}

export const PoseRecorder = () => {
    let functions: PoseRecorderFunctions = {
        Record: poseRecorderFunctionProvider.provideFunctions(PoseRecorderFunction.Record) as () => void,
        SaveRecording: poseRecorderFunctionProvider.provideFunctions(PoseRecorderFunction.SaveRecording) as (name: string) => void,
        SavedRecordingNames: poseRecorderFunctionProvider.provideFunctions(PoseRecorderFunction.SavedRecordingNames) as () => string[],
        DeleteRecording: poseRecorderFunctionProvider.provideFunctions(PoseRecorderFunction.DeleteRecording) as (recordingID: number) => void,
        LoadRecording: poseRecorderFunctionProvider.provideFunctions(PoseRecorderFunction.LoadRecording) as (recordingID: number) => void
    }

    const [recordings, setRecordings] = useState<string[]>(functions.SavedRecordingNames());
    const [selectedIdx, setSelectedIdx] = React.useState<number>();
    const [showSaveRecordingModal, setShowSaveRecordingModal] = useState<boolean>(false);
    const [isRecording, setIsRecording] = React.useState<boolean>(false)

    const SaveRecordingModal = (props: {
        setShow: (show: boolean) => void,
        show: boolean
    }) => {
        const [name, setName] = React.useState<string>("");
        function handleAccept() {
            if (name.length > 0) {
                if (!recordings.includes(name)) {
                    setRecordings(recordings => [...recordings, name])
                }
                functions.SaveRecording(name);
            }
            setName("");
        }

        return (
            <PopupModal
                setShow={props.setShow}
                show={props.show}
                onAccept={handleAccept}
                id="save-recording-modal"
                acceptButtonText="Save"
                acceptDisabled={name.length < 1}
            >
                <label htmlFor="new-recoding-name"><b>Save Recording</b></label>
                <hr/>
                <div className="recording-name">
                    <label>Recording Name</label>
                    <input autoFocus type="text" id="new-recording-name" name="new-option-name"
                        value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="Enter name"
                    />
                </div>
            </PopupModal>
        )
    }

    return (
        <React.Fragment>
            <div id="pose-recorder-container">Pose Recorder</div>
            <div id="pose-recorder-container">
                <Dropdown
                    onChange={setSelectedIdx}
                    selectedIndex={selectedIdx}
                    possibleOptions={recordings}
                    placeholderText="Select a recording..."
                />
                <button className="play-btn" onClick={() => {
                    if (selectedIdx != undefined) { 
                        functions.LoadRecording(selectedIdx)}
                    }
                }>
                    <span className="material-icons">
                        play_circle
                    </span>
                </button>
                <button className="save-btn" onClick={() => {
                        if (!isRecording) {
                            setIsRecording(true)
                            functions.Record()
                        } else {
                            setIsRecording(false)
                            setShowSaveRecordingModal(true)
                        }
                    }
                }>
                    {!isRecording
                        ? <span className="material-icons">radio_button_checked</span>
                        : <span className="material-icons">save</span>
                    }
                </button>
                <button className="delete-btn" onClick={() => {
                    if (selectedIdx != undefined) { 
                        functions.DeleteRecording(selectedIdx)}
                        setRecordings(functions.SavedRecordingNames())
                        setSelectedIdx(undefined)
                    }
                }>
                    <span className="material-icons">
                        delete_forever
                    </span>
                </button>
            </div>
            <SaveRecordingModal 
                setShow={setShowSaveRecordingModal}
                show={showSaveRecordingModal}
            />
        </React.Fragment>
    )
}