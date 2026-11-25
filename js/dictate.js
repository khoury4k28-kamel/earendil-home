// Speaking instead of typing. Uses the speech recognition built into the
// browser (the phone's or the computer's own), so only text reaches the hub.
// Where a browser doesn't offer it, canDictate() is false and the keyboard's
// own microphone key does the same job.
//
// Kept on its own so a better transcription service can take its place later:
// anything that offers canDictate() and startDictation() will do.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = () => Boolean(Recognition);

const REASONS = {
  "not-allowed": "The microphone is blocked for this page. Allow it in the browser's settings, or use the mic on your keyboard.",
  "service-not-allowed": "Dictation isn't available here. Use the mic on your keyboard.",
  "audio-capture": "No microphone was found.",
  network: "Dictation needs a connection. Type, or try again.",
};

// Starts listening. onText gets each finished phrase, onInterim the words
// still being worked out, onEnd a reason when listening stops by itself (null
// when it was stopped on purpose). Returns a function that stops it.
export function startDictation({ onText, onInterim, onEnd }) {
  let wanted = true;
  let problem = null;
  let rec = null;

  function listen() {
    rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = e.results[i][0].transcript;
        if (e.results[i].isFinal) onText(said.trim());
        else interim += said;
      }
      onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      // A pause in speech is not a problem: listening picks up again below.
      if (e.error === "no-speech" || e.error === "aborted") return;
      problem = REASONS[e.error] || "Dictation stopped. Try again, or use the mic on your keyboard.";
      wanted = false;
    };
    // Browsers stop listening after a silence. Carry on until told to stop.
    rec.onend = () => {
      onInterim("");
      if (wanted) { try { listen(); return; } catch { problem = REASONS["service-not-allowed"]; } }
      onEnd(problem);
    };
    rec.start();
  }

  try { listen(); } catch { onEnd(REASONS["service-not-allowed"]); return () => {}; }
  return () => { wanted = false; try { rec.stop(); } catch { /* already stopped */ } };
}
