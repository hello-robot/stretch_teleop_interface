import { ComponentDef, ComponentType } from "./componentdefinitions";
import { DropZoneState } from "./dropzone";
import { FunctionProvider } from "./functionprovider";
import { renderButtonPad, renderVideoStream } from "./render";
import { Tabs } from "./tabs";

/** State required for all elements */
export type SharedState = {
    customizing: boolean,
    /** Called when user clicks on a component */
    onSelect: (path: string, def: ComponentDef) => void,
    /** Gives function based on user input type */
    functionProvider: FunctionProvider,
    /** State required for all dropzones */
    dropZoneState: DropZoneState,
    /** Path to the active component */
    activePath?: string,
};

/** Properties for any of the customizable components: tabs, video streams, or
 * button pads.
 */
export type CustomizableComponentProps = {
    path: string,
    definition: ComponentDef;
    sharedState: SharedState,
}

/**
 * Takes a definition for a component and returns the react component.
 * @note switch on the component definition's `type` field
 * @returns rendered component
 */
export const CustomizableComponent = (props: CustomizableComponentProps) => {
    switch (props.definition.type) {
        case ComponentType.Tabs:
            return <Tabs {...props} />
        case ComponentType.ButtonPad:
            return renderButtonPad(props);
        case ComponentType.VideoStream:
            return renderVideoStream(props);
        default:
            throw new Error(`unknow component type: ${props.definition.type}`);
    }
}