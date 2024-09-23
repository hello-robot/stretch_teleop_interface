import React from "react";
import { className } from "shared/util";
import {
    ButtonPadDefinition,
    ButtonPadId,
    ComponentDefinition,
    ComponentId,
    ComponentType,
    LayoutDefinition,
    ParentComponentDefinition,
    TabDefinition,
    PanelDefinition,
    CameraViewDefinition,
    CameraViewId,
    MapDefinition,
} from "../utils/component_definitions";
import { PopupModal } from "../basic_components/PopupModal";
import { Dropdown } from "../basic_components/Dropdown";
import "operator/css/Sidebar.css";
import { storageHandler } from "operator/tsx/index";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";

type SidebarProps = {
    hidden: boolean;
    onDelete: () => void;
    updateLayout: () => void;
    onSelect: (def: ComponentDefinition, path?: string) => void;
    selectedDefinition?: ComponentDefinition;
    selectedPath?: string;
    globalOptionsProps: GlobalOptionsProps;
};

/** Popup on the right side of the screen while in customization mode. */
export const Sidebar = (props: SidebarProps) => {
    const deleteDisabled = props.selectedPath === undefined;
    const deleteTooltip = deleteDisabled
        ? "You must select an element before you can delete it"
        : "";
    const selectedDescription = props.selectedDefinition
        ? componentDescription(props.selectedDefinition)
        : "none";
    return (
        <div id="sidebar" hidden={props.hidden}>
            <div id="sidebar-header">
                <b>Selected: {selectedDescription}</b>
            </div>
            <div id="sidebar-body">
                {props.selectedPath ? (
                    <SidebarOptions
                        selectedDefinition={props.selectedDefinition!}
                        updateLayout={props.updateLayout}
                    />
                ) : (
                    <React.Fragment>
                        <SidebarComponentProvider
                            selectedDefinition={props.selectedDefinition}
                            onSelect={props.onSelect}
                        />
                        <SidebarGlobalOptions {...props.globalOptionsProps} />
                    </React.Fragment>
                )}
            </div>
            <div id="sidebar-footer">
                <button
                    id="delete-button"
                    disabled={deleteDisabled}
                    title={deleteTooltip}
                    className={className("btn-red", {})}
                    onClick={
                        deleteDisabled ? undefined : () => props.onDelete()
                    }
                >
                    <DeleteForeverIcon fontSize="large" />
                </button>
            </div>
        </div>
    );
};

/**
 * Creates a text description based on a component definition
 * @param definition component definition to describe
 * @returns string description of the component
 */
function componentDescription(definition: ComponentDefinition): string {
    switch (definition.type) {
        case ComponentType.ButtonPad:
        case ComponentType.CameraView:
            return `${(definition as CameraViewDefinition | ButtonPadDefinition).id} ${definition.type}`;
        case ComponentType.SingleTab:
            return `\"${(definition as TabDefinition).label}\" Tab`;
        case ComponentType.Panel:
        case ComponentType.VirtualJoystick:
        case ComponentType.ButtonGrid:
        case ComponentType.Map:
            return definition.type;
        default:
            throw Error(
                `Cannot get description for component type ${definition.type}\nYou may need to add a case for this component in the switch statement.`,
            );
    }
}

/*******************************************************************************
 * Global options
 */

/** Properties for {@link SidebarGlobalOptions} */
export type GlobalOptionsProps = {
    /** If the save/load poses should be displayed. */
    displayMovementRecorder: boolean;
    setDisplayMovementRecorder: (displayMovementRecorder: boolean) => void;

    /** If the text-to-speech component should be displayed */
    displayTextToSpeech: boolean;
    setDisplayTextToSpeech: (displayTextToSpeech: boolean) => void;

    /** If the button text labels should be displayed */
    displayLabels: boolean;
    setDisplayLabels: (displayLabels: boolean) => void;

    /** List of names of the default layouts. */
    defaultLayouts: string[];
    /** List of names of the user's custom layouts. */
    customLayouts: string[];
    /**
     * Callback when the user loads a layout.
     * @param layoutName name of the layout to load
     * @param dflt if it's a default layout, if false then it's a custom layout.
     */
    loadLayout: (layoutName: string, dflt: boolean) => void;
    /**
     * Callback when the user saves a layout.
     * @param layoutName name of the layout to save.
     */
    saveLayout: (layoutName: string) => void;
};

/** Options which apply to the entire operator page. */
const SidebarGlobalOptions = (props: GlobalOptionsProps) => {
    const [showLoadLayoutModal, setShowLoadLayoutModal] =
        React.useState<boolean>(false);
    const [showSaveLayoutModal, setShowSaveLayoutModal] =
        React.useState<boolean>(false);

    return (
        <React.Fragment>
            <div id="global-settings">
                {/* <p>Global settings:</p> */}
                <OnOffToggleButton
                    on={!props.displayLabels}
                    onClick={() => props.setDisplayLabels(!props.displayLabels)}
                    label="Display button text labels"
                />
                <OnOffToggleButton
                    on={!props.displayMovementRecorder}
                    onClick={() =>
                        props.setDisplayMovementRecorder(
                            !props.displayMovementRecorder,
                        )
                    }
                    label="Display movement recorder"
                />
                <OnOffToggleButton
                    on={!props.displayTextToSpeech}
                    onClick={() =>
                        props.setDisplayTextToSpeech(!props.displayTextToSpeech)
                    }
                    label="Display text-to-speech"
                />
                <button onClick={() => setShowLoadLayoutModal(true)}>
                    Load layout
                </button>
                <button onClick={() => setShowSaveLayoutModal(true)}>
                    Save layout
                </button>
            </div>
            <LoadLayoutModal
                defaultLayouts={props.defaultLayouts}
                customLayouts={props.customLayouts}
                loadLayout={props.loadLayout}
                setShow={setShowLoadLayoutModal}
                show={showLoadLayoutModal}
            />
            <SaveLayoutModal
                saveLayout={props.saveLayout}
                customLayouts={props.customLayouts}
                setShow={setShowSaveLayoutModal}
                show={showSaveLayoutModal}
            />
        </React.Fragment>
    );
};

/** Popup so the user can load a default layout or one of their custom layouts.  */
const LoadLayoutModal = (props: {
    defaultLayouts: string[];
    customLayouts: string[];
    loadLayout: (layoutName: string, dflt: boolean) => void;
    setShow: (show: boolean) => void;
    show: boolean;
}) => {
    const [selectedIdx, setSelectedIdx] = React.useState<number>();

    function handleAccept() {
        if (selectedIdx === undefined) return;
        let dflt: boolean, layoutName: string;
        if (selectedIdx < props.defaultLayouts.length) {
            layoutName = props.defaultLayouts[selectedIdx];
            dflt = true;
        } else {
            layoutName =
                props.customLayouts[selectedIdx - props.defaultLayouts.length];
            dflt = false;
        }
        console.log("loading layout", layoutName, dflt);
        props.loadLayout(layoutName, dflt);
    }

    function mapFunct(layoutName: string, dflt: boolean) {
        const prefix = dflt ? "DEFAULT" : "CUSTOM";
        return (
            <p>
                <em>{prefix}</em> {layoutName}
            </p>
        );
    }

    const defaultOptions = props.defaultLayouts.map((layoutName) =>
        mapFunct(layoutName, true),
    );
    const customOptions = props.customLayouts.map((layoutName) =>
        mapFunct(layoutName, false),
    );

    return (
        <PopupModal
            setShow={props.setShow}
            show={props.show}
            onAccept={handleAccept}
            id="load-layout-modal"
            acceptButtonText="Load Layout"
            acceptDisabled={selectedIdx === undefined}
        >
            <label htmlFor="load-layout-name">
                <b>Load Layout</b>
            </label>
            <Dropdown
                onChange={setSelectedIdx}
                selectedIndex={selectedIdx}
                possibleOptions={defaultOptions.concat(customOptions)}
                placeholderText="Select a layout..."
                placement="bottom"
            />
        </PopupModal>
    );
};

/** Popup so the user can save their current layout. */
const SaveLayoutModal = (props: {
    saveLayout: (layoutName: string) => void;
    customLayouts: string[];
    setShow: (show: boolean) => void;
    show: boolean;
}) => {
    const [name, setName] = React.useState<string>("");
    function handleAccept() {
        if (name.length > 0) {
            props.saveLayout(name);
            props.customLayouts.push(name);
        }
        setName("");
    }
    return (
        <PopupModal
            setShow={props.setShow}
            show={props.show}
            onAccept={handleAccept}
            id="save-layout-modal"
            acceptButtonText="Save"
            acceptDisabled={name.length < 1}
        >
            <label htmlFor="new-layout-name">
                <b>Save Layout</b>
            </label>
            <input
                autoFocus
                type="text"
                id="new-layout-name"
                name="new-tab-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name for this layout"
            />
        </PopupModal>
    );
};

/*******************************************************************************
 * Component specific options
 */

type OptionsProps = {
    /** Definition of the currently selected component from operator. */
    selectedDefinition: ComponentDefinition;
    /** Callback to rerender the layout in operator. */
    updateLayout: () => void;
};

/** Displays options for the currently selected layout component. */
const SidebarOptions = (props: OptionsProps) => {
    let contents: JSX.Element | null = null;
    switch (props.selectedDefinition.type) {
        case ComponentType.CameraView:
            switch ((props.selectedDefinition as CameraViewDefinition).id!) {
                case CameraViewId.overhead:
                    contents = <OverheadVideoStreamOptions {...props} />;
                    break;
                case CameraViewId.realsense:
                    contents = <VideoStreamOptions {...props} />;
                    break;
                case CameraViewId.gripper:
                    contents = <VideoStreamOptions {...props} />;
                    break;
            }
            break;
        case ComponentType.SingleTab:
            contents = <TabOptions {...props} />;
    }
    return <div id="sidebar-options">{contents}</div>;
};

/** Options for the overhead camera video stream layout component. */
const OverheadVideoStreamOptions = (props: OptionsProps) => {
    const definition = props.selectedDefinition as CameraViewDefinition;
    const pd =
        definition.children.length > 0 &&
        definition.children[0].type == ComponentType.PredictiveDisplay;
    const [predictiveDisplayOn, setPredictiveDisplayOn] = React.useState(pd);
    const [showButtons, setShowButtons] = React.useState<boolean>(true);

    function togglePredictiveDisplay() {
        const newPdOn = !predictiveDisplayOn;
        setPredictiveDisplayOn(newPdOn);
        if (newPdOn) {
            // Add predictive display to the stream
            definition.children = [{ type: ComponentType.PredictiveDisplay }];
        } else {
            definition.children = [];
        }
        props.updateLayout();
    }

    function toggleButtons() {
        setShowButtons(!showButtons);
        definition.displayButtons = showButtons;
        props.updateLayout();
    }

    return (
        <React.Fragment>
            {/* <OnOffToggleButton
                on={predictiveDisplayOn}
                onClick={togglePredictiveDisplay}
                label="Predictive Display"
            /> */}
            <OnOffToggleButton
                on={!definition.displayButtons}
                onClick={toggleButtons}
                label="Display Buttons"
            />
        </React.Fragment>
    );
};

/** Options for the camera video stream layout component. */
const VideoStreamOptions = (props: OptionsProps) => {
    const definition = props.selectedDefinition as CameraViewDefinition;
    const [showButtons, setShowButtons] = React.useState<boolean>(true);

    function toggleButtons() {
        setShowButtons(!showButtons);
        definition.displayButtons = showButtons;
        props.updateLayout();
    }

    return (
        <React.Fragment>
            <OnOffToggleButton
                on={!definition.displayButtons}
                onClick={toggleButtons}
                label="Display Buttons"
            />
        </React.Fragment>
    );
};

/** Options when user selects a single tab within a panel. */
const TabOptions = (props: OptionsProps) => {
    const definition = props.selectedDefinition as TabDefinition;
    const [showRenameModal, setShowRenameModal] =
        React.useState<boolean>(false);
    const [renameText, setRenameText] = React.useState<string>("");
    function handleRename() {
        if (renameText.length > 0) {
            definition.label = renameText;
            props.updateLayout();
        }
        setRenameText("");
    }
    return (
        <React.Fragment>
            <button onClick={() => setShowRenameModal(true)}>Rename Tab</button>
            <PopupModal
                show={showRenameModal}
                setShow={setShowRenameModal}
                onAccept={handleRename}
                id="new-tab-modal"
                acceptButtonText="Rename Tab"
                acceptDisabled={renameText.length < 1}
            >
                <label htmlFor="new-tab-name">
                    <b>Rename Tab</b>
                </label>
                <input
                    autoFocus
                    type="text"
                    id="new-tab-name"
                    name="new-tab-name"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    placeholder={definition.label}
                />
            </PopupModal>
        </React.Fragment>
    );
};

/** Properties for {@link OnOffToggleButton} */
type OnOffToggleButtonProps = {
    on: boolean;
    /** Callback when the button is clicked */
    onClick: () => void;
    /** Text label to display to the right of the on/off button. */
    label: string;
};

/** A single toggle button with a color and on/off label corresponding to it's state. */
const OnOffToggleButton = (props: OnOffToggleButtonProps) => {
    const text = props.on ? "on" : "off";
    const colorClass = props.on ? "btn-turquoise font-white" : "btn-red";
    return (
        <div className="toggle-button-div">
            <button
                className={"toggle-button " + colorClass}
                onClick={props.onClick}
            >
                {text}
            </button>
            <span className="global-label">{props.label}</span>
        </div>
    );
};

/*******************************************************************************
 * Component provider
 */

/** Properties for {@link SidebarComponentProvider} */
type SidebarComponentProviderProps = {
    /** Definition of the currently selected component from operator. */
    selectedDefinition?: ComponentDefinition;
    /** Callback function when a component is selected from the sidebar. */
    onSelect: (def: ComponentDefinition, path?: string) => void;
};

/** Displays all the components which can be added to the interface */
const SidebarComponentProvider = (props: SidebarComponentProviderProps) => {
    const [expandedType, setExpandedType] = React.useState<ComponentType>();

    /** The options for possible components to add */
    const outlines: ComponentProviderTabOutline[] = [
        { type: ComponentType.Panel },
        { type: ComponentType.CameraView, ids: Object.values(CameraViewId) },
        { type: ComponentType.ButtonPad, ids: Object.values(ButtonPadId) },
        { type: ComponentType.ButtonGrid },
        { type: ComponentType.VirtualJoystick },
        { type: ComponentType.Map },
    ];

    function handleSelect(type: ComponentType, id?: ComponentId) {
        const definition: ComponentDefinition = id ? { type, id } : { type };

        // Add children based on the component type
        switch (type) {
            case ComponentType.Panel:
            case ComponentType.CameraView:
                (definition as ParentComponentDefinition).children = [];
                break;
            // case ComponentType.Map:
            //     (definition as MapDefinition).storageHandler = storageHandler;
            //     break;
        }

        props.onSelect(definition);
    }

    function mapTabs(outline: ComponentProviderTabOutline) {
        const expanded = outline.type === expandedType;
        const tabProps: ComponentProviderTabProps = {
            ...outline,
            expanded,
            selectedDefinition: props.selectedDefinition,
            onExpand: () =>
                setExpandedType(expanded ? undefined : outline.type),
            onSelect: (id?: ComponentId) => handleSelect(outline.type, id),
        };
        return <ComponentProviderTab {...tabProps} key={outline.type} />;
    }

    return (
        <div id="sidebar-component-provider">
            <p>Select a component to add:</p>
            <div id="components-set">{outlines.map(mapTabs)}</div>
        </div>
    );
};

/** An outline representing a component provider tab.  */
type ComponentProviderTabOutline = {
    /** The type of component this tab represents. */
    type: ComponentType;
    /**
     * The list of different identifiers for this component type. Is undefined
     * when a component doesn't have sub identifiers, for example a Panel component.
     */
    ids?: ComponentId[];
};

/** Properties for a single tab representing a single component type. */
type ComponentProviderTabProps = ComponentProviderTabOutline & {
    expanded: boolean;
    selectedDefinition?: ComponentDefinition;
    onSelect: (id?: ComponentId) => void;
    onExpand: () => void;
};

/**
 * Displays a single dropdown tab within the component provider. If the ids field
 * in `props` is undefined then this represents a component without separate
 * identifiers, so it will be a button without a dropdown.
 */
const ComponentProviderTab = (props: ComponentProviderTabProps) => {
    const tabActive = props.type === props.selectedDefinition?.type;
    function mapIds(id: ComponentId) {
        const active = tabActive && id === props.selectedDefinition?.id;
        return (
            <button
                key={id}
                onClick={() => props.onSelect(id)}
                className={className("id-button", { active })}
            >
                {id}
            </button>
        );
    }

    function clickExpand() {
        console.log("click", props.type);
        props.ids ? props.onExpand() : props.onSelect();
    }

    return (
        <div className="provider-tab" key={props.type}>
            <button
                onClick={clickExpand}
                className={
                    tabActive && !props.ids
                        ? "active"
                        : props.expanded
                          ? "expanded"
                          : ""
                }
            >
                {props.ids ? (
                    props.expanded ? (
                        <ExpandLessIcon />
                    ) : (
                        <ExpandMoreIcon />
                    )
                ) : (
                    <></>
                )}
                {props.type}
            </button>
            <div className="provider-tab-dropdown" hidden={!props.expanded}>
                {props.ids ? props.ids.map(mapIds) : undefined}
            </div>
        </div>
    );
};
