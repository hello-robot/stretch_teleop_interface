#!/bin/bash

# Usage: ./launch_interface.sh -s localstorage
STORAGE_ARG=""
if getopts ":s:" opt && [[ $opt == "s" ]]; then
    echo "$OPTARG"
    STORAGE_ARG="-s $OPTARG"
fi

# Usage: ./launch_interface.sh -m $HELLO_FLEET_PATH/maps/<map_name>.yaml
MAP_ARG=""
if getopts ":m:" opt && [[ $opt == "m" && -f $OPTARG ]]; then
    echo "Setting map..."
    MAP_ARG="map_yaml:=$OPTARG"
fi

# Usage: ./launch_interface.sh -t pyttsx3
TTS_ARG=""
if getopts ":t:" opt && [[ $opt == "t" ]]; then
    echo "Setting tts engine..."
    TTS_ARG="tts_engine:=$OPTARG"
fi

stretch_free_robot_process.py;
./stop_interface.sh
./configure_audio.sh -m alsa_input.usb-K66_K66_20190805V001-00.analog-stereo
sudo udevadm control --reload-rules && sudo udevadm trigger
source /opt/ros/humble/setup.bash
source ~/ament_ws/install/setup.bash
source /usr/share/colcon_cd/function/colcon_cd.sh
sleep 2;
screen -dm -S "web_teleop_ros" ros2 launch stretch_web_teleop web_interface.launch.py $MAP_ARG $TTS_ARG
sleep 3;
~/ament_ws/src/stretch_web_teleop/start_web_server_and_robot_browser.sh $STORAGE_ARG
