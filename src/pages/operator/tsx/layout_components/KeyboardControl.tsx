import React from "react";
import {
  CustomizableComponentProps,
  SharedState,
  isSelected,
} from "./CustomizableComponent";
import { keyboardFunctionProvider } from "operator/tsx/index";
import { Mode } from "../function_providers/KeyboardFunctionProvider";
import "operator/css/ButtonGrid.css";
import "operator/css/KeyboardControl.css";
import { className } from "shared/util";

export const KeyboardControl = (props: CustomizableComponentProps) => {
  const [mode, setMode] = React.useState<Mode>(Mode.Base);
  const [keyPressed, setKeyPressed] = React.useState(false);
  const [activeMode, setActiveMode] = React.useState(1);
  const [toggleState, setToggleState] = React.useState(true);

  const { customizing } = props.sharedState;
  const selected = isSelected(props);

  const [keyState, setKeyState] = React.useState({
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
    j: false,
    k: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
  });

  function handleSelect(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    props.sharedState.onSelect(props.definition, props.path);
  }

  const handleKeyPress = React.useCallback(
    (event) => {
      if (keyPressed === true) {
        return;
      }
      setKeyPressed(true);

      switch (event.key) {
        case "1":
          setMode(Mode.Base);
          setActiveMode(1);
          console.log("base mode enabled");
          break;
        case "2":
          setMode(Mode.Wrist);
          setActiveMode(2);
          console.log("wrist mode enabled");
          break;
        case "3":
          setMode(Mode.Arm);
          setActiveMode(3);
          console.log("arm mode enabled");
          break;
      }

      let functs = keyboardFunctionProvider.provideFunctions(mode, event.key);
      functs.onClick();
      setKeyState((prevState) => ({ ...prevState, [event.key]: true }));
      //functs.active();
    },
    [mode, keyPressed],
  );

  const handleKeyRelease = React.useCallback(
    (event) => {
      console.log("Key Released");
      setKeyPressed(false);
      setKeyState((prevState) => ({ ...prevState, [event.key]: false }));

      let functs = keyboardFunctionProvider.provideFunctions(mode, event.key);
      functs.onRelease();
    },
    [mode, keyPressed],
  );

  React.useEffect(() => {
    //window.onkeydown  = handleKeyPress;
    // window.onkeyup = function(){
    //   this.onkeydown = handleKeyPress;
    // }
    window.addEventListener("keydown", handleKeyPress);
    window.addEventListener("keyup", handleKeyRelease);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
      window.removeEventListener("keyup", handleKeyRelease);
    };
  }, [handleKeyPress, handleKeyRelease]);

  const ToggleButton = () => {
    setToggleState((prevToggleState) => !prevToggleState);
  };

  return (
    <div className="keyboard-control">
      <div className="keyboard-row">
        <div className="keyboard-column">
          <div className="current-mode">Current Mode: {mode}</div>
          <div className="mode-button">
            <button
              className={activeMode === 1 ? "mode-button active" : "button"}
              disabled
            >
              {" "}
              1{" "}
            </button>
            <button
              className={activeMode === 2 ? "mode-button active" : "button"}
              disabled
            >
              {" "}
              2{" "}
            </button>
            <button
              className={activeMode === 3 ? "mode-button active" : "button"}
              disabled
            >
              {" "}
              3{" "}
            </button>
          </div>
        </div>
        <div className="keyboard-column">
          <div className="item">Toggle Keys?</div>
          <button
            className={`${toggleState ? "toggle-key active" : "toggle-key off"}`}
            onClick={ToggleButton}
          >
            {" "}
            {toggleState ? "ON" : "OFF"}{" "}
          </button>
        </div>
      </div>
      <div className="keyboard-row">
        <div className="controls-container">
          Camera Controls <br />
          <div className="controls-column">
            <button
              className={keyState.ArrowUp ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              ^{" "}
            </button>
          </div>
          <div className="controls-column">
            <button
              className={keyState.ArrowLeft ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              &lt;{" "}
            </button>
            <button
              className={keyState.ArrowDown ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              v{" "}
            </button>
            <button
              className={keyState.ArrowRight ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              &gt;{" "}
            </button>
          </div>
        </div>
        <div className="gripper-container">
          Gripper Controls <br />
          <div className="gripper-column">
            <button
              className={keyState.j ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              J{" "}
            </button>
            <button
              className={keyState.k ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              K{" "}
            </button>
          </div>
        </div>
      </div>
      <div className="keyboard-row">
        <div className="controls-container">
          Mode Controls
          <br />
          <div className="controls-column">
            {activeMode === 2 && (
              <button
                className={keyState.q ? "keyboard-button active" : ""}
                disabled
              >
                {" "}
                Q{" "}
              </button>
            )}
            <button
              className={keyState.w ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              W{" "}
            </button>
            {activeMode === 2 && (
              <button
                className={keyState.e ? "keyboard-button active" : ""}
                disabled
              >
                {" "}
                E{" "}
              </button>
            )}
          </div>
          <div className="controls-column">
            <button
              className={keyState.a ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              A{" "}
            </button>
            <button
              className={keyState.s ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              S{" "}
            </button>
            <button
              className={keyState.d ? "keyboard-button active" : ""}
              disabled
            >
              {" "}
              D{" "}
            </button>
          </div>
        </div>
      </div>
    </div>
    // <div className="keyboard-control">
    //   <div className= "mode-button">
    //     Mode Buttons <br/>
    //     <button className = {activeMode === 1 ? 'mode-button active' : ''} disabled> 1 </button>
    //     <button className = {activeMode === 2 ? 'mode-button active' : ''} disabled> 2 </button>
    //     <button className = {activeMode === 3 ? 'mode-button active' : ''} disabled> 3 </button>
    //   </div>

    //   <div className = "item">Current Mode: {mode}</div>

    //   <div className = "item">
    //     Toggle Controls <br/>
    //     <ToggleButton />
    //   </div>

    //   <div className = "controls-container">
    //     Mode Controls<br/>
    //     <div className = "controls-row">
    //       {activeMode === 2 && (<button className = {keyState.q  ? "active" : '' } disabled> Q </button>)}
    //       <button className = {keyState.w  ? "keyboard-button active" : '' } disabled> W </button>
    //       {/* className = {keyState.W === true ? "active" : undefined } */}
    //       {activeMode === 2 && (<button className = {keyState.e  ? "active" : '' } disabled> E </button>)}
    //     </div>
    //     <div className = "controls-row">
    //       <button className = {keyState.a  ? "keyboard-button active" : '' } disabled> A </button>
    //       <button className = {keyState.s  ? "keyboard-button active" : '' } disabled> S </button>
    //       <button className = {keyState.d  ? "keyboard-button active" : '' } disabled> D </button>
    //     </div>
    //   </div>

    //   <div className = "gripper-container">
    //     Gripper Controls <br/>
    //     <button className = {keyState.j  ? "keyboard-button active" : '' } disabled> J </button>
    //     <button className = {keyState.k  ? "keyboard-button active" : '' } disabled> K </button>
    //   </div>

    //   <div className = "controls-container">
    //     Camera Controls <br/>
    //     <div className = "controls-row">
    //       <button className = {keyState.ArrowUp  ? "keyboard-button active" : '' } disabled> ^ </button>
    //     </div>
    //     <div className = "controls-row">
    //       <button className = {keyState.ArrowLeft  ? "keyboard-button active" : '' } disabled> &lt; </button>
    //       <button className = {keyState.ArrowDown  ? "keyboard-button active" : '' } disabled> v </button>
    //       <button className = {keyState.ArrowRight ? "keyboard-button active" : '' } disabled> &gt; </button>
    //     </div>
    //   </div>
    // </div>
  );
};
