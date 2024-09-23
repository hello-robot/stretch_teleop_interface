#!/bin/bash

# Usage: ./configure_audio.sh -s <speaker_name> -m <mic_name>
#
# To get a list of valid speaker names, run:
#     pactl list short sinks
# To get a list of valid microphone names, run:
#     pactl list short sources
# Note that with a microphone, there is no need to specify a device name if there is
# only one external mic plugged in; that one will **always** be prioritized over the
# robot's built-in microphone. The only way to use the robot's built-in microphone
# is to disconnect all external microphones.


# Configure command line arguments
SPEAKER_NAME="alsa_output.pci-0000_00_1f.3.analog-stereo"
MIC_NAME=""
while getopts ":s:m:" opt
do
    case $opt in
        s ) SPEAKER_NAME="$OPTARG" ;;
        m ) MIC_NAME="$OPTARG" ;;
    esac
done


echo "Configuring audio...Note that this script may not work if X-11 forwarding is enabled."

# Set the default speaker
sinks=$(pactl list short sinks)
if [[ $sinks == *"$SPEAKER_NAME"* ]]; then
    echo "    Setting speaker to $SPEAKER_NAME"
    pactl set-default-sink $SPEAKER_NAME
else
    echo "    Speaker name is invalid"
    echo "    To get valid speaker names, run:"
    echo "        pactl list short sinks"
fi

# Set the default microphone
if [ ${#MIC_NAME} -gt 0 ]; then
    sources=$(pactl list short sources)
    if [[ $sources == *"$MIC_NAME"* ]]; then
        echo "    Setting microphone to $MIC_NAME"
        pactl set-default-source $MIC_NAME
    else
        echo "    Microphone name is invalid"
        echo "    To get valid microphone names, run:"
        echo "        pactl list short sources"
    fi
fi

# Unmute and set volume to 100% for relevant audio devices
amixer_output=$(amixer scontrols)
amixer_devices=('Master' 'PCM' 'Capture' 'Mic' 'Digital')
for device in "${amixer_devices[@]}"
do
    if [[ $amixer_output == *"'$device'"* ]]; then
        echo "    Unmuting '$device'"
        device_output=$(amixer get $device)
        if [[ $device_output == *"[off]"* ]]; then
            if [[ $device_output == *"Capture"* ]]; then
                amixer set $device cap -q
            else
                amixer set $device unmute -q
            fi
        fi

        echo "    Setting '$device' to 100%"
        amixer sset $device 100% -q
    fi
done

echo "Done configuring audio!"
