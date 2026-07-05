/* ============================================================
   BROWNS RADIO — PLAYLIST
   ============================================================
   To add a song:

     1. Drop the audio file (MP4 / M4A, AAC, MP3) into the music/ folder.
     2. Add one line to the SONGS array below:

          { title: 'Song Name', file: 'music/song-name.mp4', preset: 1 },

        - title   : shown on the radio LCD and in the track list
        - file    : path to the file inside the music/ folder
        - preset  : (optional) 1-6 — pins the song to that preset
                    button. Songs without a preset fill the remaining
                    buttons in playlist order.
        - station : (optional) the FM band this song also belongs to.
                    Every song always plays on the main "BROWNS FM"
                    band. Giving a song a station name adds an extra
                    band button (e.g. "Addison-Ann FM") that tunes to
                    just the songs sharing that name. Leave it off for
                    a normal BROWNS-FM-only track.

     3. Bump the ?v= version on this file's <script> tag in
        index.html so the radio picks up the change.
   ============================================================ */

const SONGS = [
  { title: 'Forever You and Me', file: 'music/forever-you-and-me.mp3', preset: 1 },
  { title: "That's My Boy",      file: 'music/thats-my-boy.mp3',       preset: 2 },
  { title: 'Addison-Ann Lili',   file: 'music/addison-ann-lili.mp3',   station: 'Addison-Ann FM' },
  { title: 'Little Bird',        file: 'music/little-bird.mp3',        station: 'Addison-Ann FM' },
];
