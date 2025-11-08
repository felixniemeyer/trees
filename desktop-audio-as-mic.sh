#!/usr/bin/env bash
#
# Enable desktop audio capture in Firefox (or any app) on Linux with PulseAudio.
# Creates a virtual sink to route system output into a recordable source.
# Automatically detects and matches sample rate and channels from default sink.
#
# Usage:
# ./desktop-audio-capture.sh
#
# Stop with Ctrl+C (it will automatically unload all temporary modules).
set -e
echo "🔊 Setting up virtual audio capture..."
# Get default output sink name
DEFAULT_SINK=$(pactl get-default-sink)
echo "➡️ Default output sink: $DEFAULT_SINK"
# Extract sample rate and channels from default sink
SAMPLE_SPEC=$(pactl list sinks | grep -A 10 "Name: $DEFAULT_SINK" | grep "Sample Specification" | awk '{print $3 " " $4 " " $5}')
if [ -z "$SAMPLE_SPEC" ]; then
  echo "❌ Failed to detect sample spec. Falling back to defaults (s16le 2ch 44100Hz)."
  FORMAT="s16le"
  CHANNELS="2ch"
  RATE="44100Hz"
else
  FORMAT=$(echo $SAMPLE_SPEC | awk '{print $1}')
  CHANNELS=$(echo $SAMPLE_SPEC | awk '{print $2}')
  RATE=$(echo $SAMPLE_SPEC | awk '{print $3}')
fi
echo "🎛️ Detected sample spec: Format=$FORMAT, Channels=$CHANNELS, Rate=$RATE"
# Load null sink (virtual output) with matching specs
VIRTUAL_SINK_NAME="VirtualSink"
VIRTUAL_SINK_DESC="Virtual Desktop Audio Sink"
VIRTUAL_SINK_MODULE=$(pactl load-module module-null-sink sink_name=$VIRTUAL_SINK_NAME sink_properties=device.description="$VIRTUAL_SINK_DESC" format=$FORMAT channels=${CHANNELS%ch} rate=${RATE%Hz})
echo "✅ Created virtual sink: $VIRTUAL_SINK_NAME (module $VIRTUAL_SINK_MODULE)"
# Load loopback with matching specs and higher latency to avoid distortion
LOOPBACK_MODULE=$(pactl load-module module-loopback source="${DEFAULT_SINK}.monitor" sink="$VIRTUAL_SINK_NAME" latency_msec=20 format=$FORMAT channels=${CHANNELS%ch} rate=${RATE%Hz})
echo "✅ Created loopback: from $DEFAULT_SINK.monitor → $VIRTUAL_SINK_NAME (module $LOOPBACK_MODULE)"
# Show available sources (recordable devices)
echo
echo "🎤 Available recording sources (for Firefox or other apps):"
pactl list short sources | grep -E "monitor|VirtualSink" | awk '{print " - " $2}'
echo
echo "💡 When Firefox asks for an audio source, select:"
echo " ▶️ Monitor of $VIRTUAL_SINK_NAME"
echo
echo "Press Ctrl+C to stop and remove virtual devices."
# Wait until user stops
trap 'echo; echo "🧹 Cleaning up..."; pactl unload-module $LOOPBACK_MODULE; pactl unload-module $VIRTUAL_SINK_MODULE; echo "✅ Done. Audio routing restored."; exit 0' SIGINT
# Keep running until Ctrl+C
while true; do sleep 1; done
