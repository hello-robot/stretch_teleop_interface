#!/usr/bin/env python3

# Standard imports
import os
import readline  # Improve interactive input, e.g., up to access history, tab auto-completion.
import sys
import threading
from typing import List, Optional

# Third-party imports
import rclpy
from ament_index_python import get_package_share_directory
from rclpy.node import Node

# Local Imports
from stretch_web_teleop.msg import TextToSpeech


def print_and_flush(message: str):
    """
    Print a message and flush the output.

    Parameters
    ----------
    message : str
        The message to print.
    """
    print(message)
    sys.stdout.flush()


class HistoryCompleter:
    """
    This class enables readline tab auto-completion from the history.

    Adapted from https://pymotw.com/3/readline/
    """

    def __init__(self):
        """
        Initialize the HistoryCompleter.
        """
        self.matches = []

    @staticmethod
    def get_history_items() -> List[str]:
        """
        Get the history items.

        Returns
        -------
        List[str]
            The history items.
        """
        num_items = readline.get_current_history_length() + 1
        return [readline.get_history_item(i) for i in range(1, num_items)]

    def complete(self, text: str, state: int) -> Optional[str]:
        """
        Return the next possible completion for 'text'.

        This is called successively with state == 0, 1, 2, ... until it returns None.

        Parameters
        ----------
        text : str
            The string to complete.
        state : int
            The state of the completion.

        Returns
        -------
        Optional[str]
            The next possible completion for 'text'.
        """
        response = None
        if state == 0:
            history_values = HistoryCompleter.get_history_items()
            if text:
                self.matches = sorted(
                    h for h in history_values if h and h.startswith(text)
                )
            else:
                self.matches = []
        try:
            response = self.matches[state]
        except IndexError:
            response = None
        return response


class TextToSpeechUserInterfaceNode(Node):
    """
    A ROS2 node that provides a user interface for text-to-speech.
    """

    def __init__(self):
        """
        Initialize the TextToSpeechUserInterfaceNode.
        """
        # Initialize the node
        super().__init__("text_to_speech_ui")

        # Create the publisher
        self.publisher = self.create_publisher(TextToSpeech, "text_to_speech", 1)

    def publish_message(self, message: str):
        """
        Publish a message to the text-to-speech topic.

        Parameters
        ----------
        message : str
            The message to publish.
        """
        # Create the message
        msg = TextToSpeech(
            text=message,
            is_slow=True,
            override_behavior=(
                TextToSpeech.OVERRIDE_BEHAVIOR_INTERRUPT
                if len(message) == 0
                else TextToSpeech.OVERRIDE_BEHAVIOR_QUEUE
            ),
        )

        # Publish the message
        self.publisher.publish(msg)

    def run(self):
        """
        Create the user interface for the text-to-speech node.
        """
        # Create the input prompt
        print_and_flush(
            "****************************************************************"
        )
        print_and_flush("Instructions:")
        print_and_flush("    Type a message to convert to speech.")
        print_and_flush("    Press S to stop the current message.")
        print_and_flush("    Press Q to exit and stop the current message.")
        print_and_flush("    Press Ctrl-C to exit without stopping the current message")
        print_and_flush(
            "****************************************************************"
        )

        # Get the user input
        while rclpy.ok():
            # Get the user input
            message = input("\nMessage (S to stop, Q to exit): ").strip()

            # Process the special 1-character commands
            if len(message) == 0:
                continue
            elif len(message) == 1:
                if message.upper() == "Q":
                    self.publish_message("")
                    readline.remove_history_item(
                        readline.get_current_history_length() - 1
                    )
                    raise KeyboardInterrupt
                elif message.upper() == "S":
                    # Stop the current message
                    self.publish_message("")
                    readline.remove_history_item(
                        readline.get_current_history_length() - 1
                    )
                    continue

            # Publish the message
            self.publish_message(message)


def spin(node: Node, executor: rclpy.executors.Executor):
    """
    Spin the node in the background.

    Parameters
    ----------
    node : Node
        The node to spin.
    executor : rclpy.executors.Executor
        The executor to spin.
    """
    try:
        rclpy.spin(node, executor)
    except rclpy.executors.ExternalShutdownException:
        pass


if __name__ == "__main__":
    # Configure the GNU readline module for better interactive input
    history_filename = "text_to_speech_ui_history.txt"
    config_share_dir = os.path.join(
        get_package_share_directory("stretch_web_teleop"),
        "config",
    )
    config_src_dir = os.path.expanduser("~/ament_ws/src/stretch_web_teleop/config")
    readline.read_history_file(os.path.join(config_share_dir, history_filename))
    readline.set_completer(HistoryCompleter().complete)
    readline.parse_and_bind("tab: complete")
    readline.set_completer_delims("")  # Match the entire string, not individual words

    # Initialize the node
    rclpy.init()
    node = TextToSpeechUserInterfaceNode()
    print_and_flush("Initialized the text-to-speech user interface node.")

    # Spin in the background, as the node initializes
    executor = rclpy.executors.SingleThreadedExecutor()
    spin_thread = threading.Thread(
        target=spin,
        args=(node,),
        kwargs={"executor": executor},
        daemon=True,
    )
    spin_thread.start()

    # Run the node
    try:
        node.run()
    except KeyboardInterrupt:
        node.destroy_node()
        try:
            rclpy.shutdown()
        except rclpy._rclpy_pybind11.RCLError:
            pass
        print("")

    # Save the history
    readline.write_history_file(os.path.join(config_share_dir, history_filename))
    print_and_flush(f"Saved the history to {config_share_dir}")
    if os.path.isdir(config_src_dir):
        readline.write_history_file(os.path.join(config_src_dir, history_filename))
        print_and_flush(f"Saved the history to {config_src_dir}")
    else:
        print_and_flush(
            f"Could not save the history to {config_src_dir} . Please manually copy it "
            f"from {config_share_dir} to {config_src_dir}"
        )

    # Spin in the foreground
    spin_thread.join()
    print_and_flush("Cleanly terminated.")
