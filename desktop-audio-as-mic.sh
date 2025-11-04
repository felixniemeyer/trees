#!/usr/bin/env bash
#
# Enable desktop audio capture in Firefox (or any app) on Linux with PulseAudio.
# Creates a virtual sink to route system output into a recordable source.
#
# Usage:
#   ./desktop-audio-capture.sh
#
# Stop with Ctrl+C (it will automatically unload all temporary modules).

set -e

echo "🔊 Setting up virtual audio capture..."

# Get default output sink name
DEFAULT_SINK=$(pactl get-default-sink)
echo "➡️  Default output sink: $DEFAULT_SINK"

# Load null sink (virtual output)
VIRTUAL_SINK_NAME="VirtualSink"
VIRTUAL_SINK_DESC="Virtual Desktop Audio Sink"

VIRTUAL_SINK_MODULE=$(pactl load-module module-null-sink sink_name=$VIRTUAL_SINK_NAME sink_properties=device.description="$VIRTUAL_SINK_DESC")
echo "✅ Created virtual sink: $VIRTUAL_SINK_NAME (module $VIRTUAL_SINK_MODULE)"

# Load loopback to mirror your current output into the virtual sink
LOOPBACK_MODULE=$(pactl load-module module-loopback source="${DEFAULT_SINK}.monitor" sink="$VIRTUAL_SINK_NAME" latency_msec=1)
echo "✅ Created loopback: from $DEFAULT_SINK.monitor → $VIRTUAL_SINK_NAME (module $LOOPBACK_MODULE)"

# Show available sources (recordable devices)
echo
echo "🎤 Available recording sources (for Firefox or other apps):"
pactl list short sources | grep -E "monitor|VirtualSink" | awk '{print " - " $2}'

echo
echo "💡 When Firefox asks for an audio source, select:"
echo "   ▶️  Monitor of $VIRTUAL_SINK_NAME"
echo
echo "Press Ctrl+C to stop and remove virtual devices."

# Wait until user stops
trap 'echo; echo "🧹 Cleaning up..."; pactl unload-module $LOOPBACK_MODULE; pactl unload-module $VIRTUAL_SINK_MODULE; echo "✅ Done. Audio routing restored."; exit 0' SIGINT

# Keep running until Ctrl+C
while true; do sleep 1; done
