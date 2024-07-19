import { className } from "shared/util";
import "operator/css/basic_components.css";
import { isMobile } from "react-device-detect";
import React from "react";

/**
 * Properties for {@link CheckToggleButton}
 */
type CheckToggleButtonProps = {
    /** Toggled on if true, toggled off if false. */
    checked: boolean;
    /**
     * Function when button is clicked, this should probably toggle the state
     * of `checked`
     */
    onClick: () => void;
    /**
     * Text to display on the button to the right of the checkbox.
     */
    label: string;
};

/**
 * A button with a check box on the left side to indicate if the button is
 * toggled on or off.
 *
 * @param props {@link CheckToggleButtonProps}
 */
export const CheckToggleButton = (props: CheckToggleButtonProps) => {
    const { checked } = props;
    const icon = checked ? "check_box" : "check_box_outline_blank";
    return (
        <button
            className={className(
                isMobile ? "check-toggle-button-mobile" : "check-toggle-button",
                { checked },
            )}
            onPointerDown={props.onClick}
        >
            <span className={"material-icons"}>{icon}</span>
            {props.label}
        </button>
    );
};
