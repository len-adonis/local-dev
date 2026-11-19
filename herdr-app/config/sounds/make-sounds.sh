#!/bin/bash
# Rebuilds Herdr's two alert sounds from the full Samsung washer song.
#
#   samsung_washer.mp3        source: "samsung washing machine song FULL"
#                             (59.7 s). Do not edit it. Get it with:
#     curl -L -o samsung_washer.mp3 https://www.myinstants.com/media/sounds/samsung-washing-machine-song-full.mp3
#   samsung_done.mp3          "done" chime: the song's A note, then the same
#                             A raised to E, joined smoothly, played faster.
#   samsung_washer_phrase.mp3 "blocked" sound: the first two phrases.
#
# Usage: ./make-sounds.sh [output folder]   (default: this folder)
# Needs ffmpeg. Change the numbers below, run it, then press Play in
# Herdr > Settings > Alerts. settings.json does not change.

set -euo pipefail

# --- done chime ---
NOTE_AT=1.50        # where the A note starts in the song (seconds)
FIRST_LEN=0.40      # how long the first note (A) plays
SECOND_LEN=0.56     # how long the second note plays, before the overlap
SEMITONES=7         # how far the second note goes up (7 = A to E)
SECOND_FADE_AT=0.25 # the second note starts to fade out after this time
OVERLAP=0.12        # how long the two notes overlap (more = smoother)
SPEED=1.25          # 1.25 = 25% faster; the pitch does not change

# --- blocked phrase ---
# The song has a near-silent break after each phrase: 4.7, 9.5, 14.3, 19.1 s.
PHRASE_END=9.55     # cut here (end of the second phrase)
PHRASE_FADE=1.2     # fade out over the last part (seconds)

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/samsung_washer.mp3"
OUT="${1:-$HERE}"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
MP3=(-codec:a libmp3lame -b:a 128k)

# done chime
ratio="$(python3 -I -c "print(2**($SEMITONES/12))")"
ff -ss "$NOTE_AT" -i "$SRC" -t "$FIRST_LEN" -af "afade=t=in:d=0.01" \
   -ar 48000 -ac 2 "$WORK/first.wav"
ff -ss "$NOTE_AT" -i "$SRC" -t "$SECOND_LEN" -ar 48000 -ac 2 "$WORK/a.wav"
ff -i "$WORK/a.wav" \
   -af "asetrate=48000*${ratio},aresample=48000,atempo=1/${ratio},afade=t=out:st=${SECOND_FADE_AT}:d=$(python3 -I -c "print($SECOND_LEN-$SECOND_FADE_AT)")" \
   "$WORK/second.wav"
ff -i "$WORK/first.wav" -i "$WORK/second.wav" \
   -filter_complex "[0][1]acrossfade=d=${OVERLAP}:c1=qsin:c2=qsin,atempo=${SPEED}" \
   "${MP3[@]}" "$OUT/samsung_done.mp3"

# blocked phrase
ff -i "$SRC" -t "$PHRASE_END" \
   -af "afade=t=out:st=$(python3 -I -c "print($PHRASE_END-$PHRASE_FADE)"):d=${PHRASE_FADE}" \
   "${MP3[@]}" "$OUT/samsung_washer_phrase.mp3"

echo "wrote $OUT/samsung_done.mp3 and $OUT/samsung_washer_phrase.mp3"
