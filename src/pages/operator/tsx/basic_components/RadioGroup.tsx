import React from "react";
import { className } from "shared/util";
import "operator/css/RadioGroup.css";
import { isMobile } from "react-device-detect";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

export const RadioButton = (props: {
    label: string;
    selected: boolean;
    onClick: () => void;
    functs: RadioFunctions;
}) => {
    return (
        <div
            className={isMobile ? "radio-btn-mobile" : "radio-btn"}
            onClick={props.onClick}
        >
            <label key={props.label}>
                <input
                    type="radio"
                    className={isMobile ? "radio-mobile" : "radio"}
                    value={props.label}
                    key={props.label}
                    checked={props.selected}
                    onChange={props.onClick}
                />
                {props.label}
            </label>
            <div className="modify">
                {props.functs.Edit && (
                    <span className="material-icons radio-icon">
                        mode_edit_outline
                    </span>
                )}
                {props.functs.Delete && (
                    <span
                        className="material-icons"
                        onClick={() => props.functs.Delete!(props.label)}
                    >
                        delete_outline
                    </span>
                )}
            </div>
        </div>
    );
};

export interface RadioFunctions {
    GetLabels: () => string[];
    SelectedLabel: (label: string) => void;
    // Add?: () => void
    Edit?: (label: string) => void;
    Delete?: (label: string) => void;
    // Start?: (label: string) => void,
    // Cancel?: () => void
}

export const RadioGroup = (props: { functs: RadioFunctions }) => {
    const [selected, setSelected] = React.useState<string>();

    return (
        <div
            className={isMobile ? "radio-group-mobile" : "radio-group"}
            onContextMenu={(e) => e.preventDefault()}
        >
            {props.functs.GetLabels().map((label, index) => (
                <RadioButton
                    key={label}
                    label={label}
                    selected={selected === label}
                    onClick={() => {
                        if (selected === label) {
                            setSelected("");
                            props.functs.SelectedLabel("");
                        } else {
                            setSelected(label);
                            props.functs.SelectedLabel(label);
                        }
                    }}
                    functs={props.functs}
                />
            ))}
            {/* {props.functs.Add &&
                <span className="material-icons add-btn">
                    add
                </span>
            }
            {props.functs.Start &&
                <span className="material-icons start-btn">
                    play_arrow
                </span>
            } */}
        </div>
    );
};
