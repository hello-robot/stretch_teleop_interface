import React from "react";
import "operator/css/velocitycontrol.css";

/**Details of a velocity setting */
type VelocityDetails = {
    /**Name of the setting to display on the button */
    label: string,
    /**The speed of this setting */
    scale: number
};

/**Props for VelocityControl */
type VelocityControlProps = {
    /** Initial speed when interface first loaded. */
    scale: number;
    /**
     * Callback function when a new speed is selected.
     * @param newSpeed the new selected speed
     */
    onChange: (newScale: number) => void;
}

/**The different velocity settings to display. */
export const VELOCITY_SCALE: VelocityDetails[] = [
    { label: "Slowest", scale: 0.2 },
    { label: "Slow", scale: 0.4 },
    { label: "Medium", scale: 0.8 },
    { label: "Fast", scale: 1.2 },
    { label: "Fastest", scale: 1.6 }
]

/**The speed the interface should initialize with */
export const DEFAULT_VELOCITY_SCALE: number = VELOCITY_SCALE[2].scale;

/** The velocity control buttons. */
export const VelocityControl = (props: VelocityControlProps) => {
    /** Maps the velocity labels and speeds to radio buttons */
    const mapFunc = ({ scale, label }: VelocityDetails) => {
        const active = scale === props.scale;
        return (
            <button
                key={label}
                className={active ? "active" : ""}
                onClick={() => props.onChange(scale)}
            >{label}</button>
        )
    }

    return (
        <div id="velocity-control-container">
            {VELOCITY_SCALE.map(mapFunc)}
        </div>
    );
}