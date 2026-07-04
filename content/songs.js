/* ============================================================
   BROWNS RADIO — PLAYLIST
   ============================================================
   To add a song:

     1. Drop the audio file (MP4 / M4A, AAC) into the music/ folder.
     2. Add one line to the SONGS array below:

          { title: 'Song Name', file: 'music/song-name.mp4', preset: 1 },

        - title  : shown on the radio LCD and in the track list
        - file   : path to the file inside the music/ folder
        - preset : (optional) 1-6 — pins the song to that preset
                   button. Songs without a preset fill the remaining
                   buttons in playlist order.

     3. Bump the ?v= version on this file's <script> tag in
        index.html so the radio picks up the change.
   ============================================================ */

const SONGS = [
  { title: 'Forever You and Me', file: 'music/forever-you-and-me.mp3', preset: 1 },
  { title: "That's My Boy",      file: 'music/thats-my-boy.mp3',       preset: 2 },
];
