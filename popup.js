let audioContext = null;
let recorder = null;
let gumStream = null;
let isRecording = false;

// Update debug logging to use background script
const debug = {
  log: function(message, data) {
    console.log(`[ASL Debug] ${message}`, data || '');
    chrome.runtime.sendMessage({
      type: 'log',
      message: message,
      data: data
    });
  },
  error: function(message, error) {
    console.error(`[ASL Debug] ${message}`, error);
    chrome.runtime.sendMessage({
      type: 'error',
      message: message,
      error: error
    });
  }
};

const startBtn = document.getElementById("startRecording");
const stopBtn = document.getElementById("stopRecording");
const transcriptBox = document.getElementById("transcript");
const aslAnimation = document.getElementById("aslAnimation");
const videoElement = document.getElementById("outputVideo");

// Verify all elements are found
if (!startBtn || !stopBtn || !transcriptBox || !aslAnimation || !videoElement) {
  debug.error("Required elements not found", {
    startBtn: !!startBtn,
    stopBtn: !!stopBtn,
    transcriptBox: !!transcriptBox,
    aslAnimation: !!aslAnimation,
    videoElement: !!videoElement
  });
}

class Recorder {
  constructor(source) {
    try {
      this.context = source.context;
      this.node = this.context.createScriptProcessor(4096, 1, 1);
      this.buffer = [];
      this.recording = false;

      this.node.onaudioprocess = (e) => {
        if (!this.recording) return;
        this.buffer.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(this.node);
      this.node.connect(this.context.destination);
      debug.log("Recorder initialized successfully");
    } catch (error) {
      debug.error("Error initializing recorder", error);
      throw error;
    }
  }

  record() {
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  exportWAV(cb) {
    let flatBuffer = this.flattenArray();
    let wavBlob = this.encodeWAV(flatBuffer);
    cb(wavBlob);
  }

  flattenArray() {
    let length = 0;
    for (let i = 0; i < this.buffer.length; i++) length += this.buffer[i].length;
    let result = new Float32Array(length);
    let offset = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      result.set(this.buffer[i], offset);
      offset += this.buffer[i].length;
    }
    return result;
  }

  encodeWAV(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');

    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, this.context.sampleRate, true);
    view.setUint32(28, this.context.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    this.floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: 'audio/wav' });
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      output.setInt16(offset, s, true);
    }
  }
}

// Add ripple effect to buttons
document.querySelectorAll('.button').forEach(button => {
  button.addEventListener('click', (e) => {
    try {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const ripple = button.querySelector('.ripple');
      if (ripple) {
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.animation = 'none';
        ripple.offsetHeight; // Trigger reflow
        ripple.style.animation = 'ripple 0.6s linear';
      }
    } catch (error) {
      debug.error("Error in button click handler", error);
    }
  });
});

// Update status indicators
const transcriptStatus = document.querySelector('.transcript-box .status-dot');
const aslStatus = document.querySelector('.asl-display .status-dot');
const transcriptStatusText = document.querySelector('.transcript-box .status-text');
const aslStatusText = document.querySelector('.asl-display .status-text');

function updateStatus(dot, text, status, statusText) {
  try {
    if (dot) {
      dot.className = 'status-dot ' + status;
    }
    if (text) {
      text.textContent = statusText;
    }
    debug.log(`Status updated: ${status} - ${statusText}`);
  } catch (error) {
    debug.error("Error updating status", error);
  }
}

async function fetchVideo(text) {
  try {
    updateStatus(aslStatus, aslStatusText, 'processing', 'Converting to ASL');
    
    // Show loading state in video area
    const placeholderContent = document.querySelector('.placeholder-content');
    if (placeholderContent) {
      placeholderContent.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Generating ASL video...</p>
      `;
    }
    
    debug.log('Sending text to API:', text);
    const response = await fetch('https://flaskapitext2video.onrender.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });

    if (!response.ok) {
      const error = await response.json();
      debug.error("Error fetching ASL video", error);
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    debug.log('Response content type:', contentType);

    const blob = await response.blob();
    debug.log('Received blob:', { type: blob.type, size: blob.size });

    const videoUrl = URL.createObjectURL(blob);
    
    if (videoElement) {
      // Show loading state
      updateStatus(aslStatus, aslStatusText, 'processing', 'Loading video...');
      
      // Add loading event listeners
      videoElement.onloadstart = () => {
        debug.log('Video loading started');
        updateStatus(aslStatus, aslStatusText, 'processing', 'Loading video...');
      };
      
      videoElement.onprogress = () => {
        debug.log('Video loading progress');
        updateStatus(aslStatus, aslStatusText, 'processing', 'Loading video...');
      };
      
      videoElement.onloadeddata = () => {
        debug.log('Video data loaded');
        updateStatus(aslStatus, aslStatusText, 'ready', 'Ready');
        if (placeholderContent) {
          placeholderContent.style.display = 'none';
        }
      };
      
      videoElement.oncanplay = () => {
        debug.log('Video can play');
        updateStatus(aslStatus, aslStatusText, 'ready', 'Ready to play');
      };
      
      videoElement.onerror = (e) => {
        debug.error('Error loading video', e);
        updateStatus(aslStatus, aslStatusText, 'error', 'Error loading video');
        if (placeholderContent) {
          placeholderContent.innerHTML = `
            <span class="placeholder-icon">❌</span>
            <p>Error loading video. Please try again.</p>
          `;
          placeholderContent.style.display = 'block';
        }
      };

      videoElement.src = videoUrl;
      videoElement.load();
      
      debug.log('Video element state:', {
        src: videoElement.src,
        readyState: videoElement.readyState,
        error: videoElement.error
      });
    }
  } catch (error) {
    debug.error('Error fetching ASL video', error);
    updateStatus(aslStatus, aslStatusText, 'error', 'Error');
    const placeholderContent = document.querySelector('.placeholder-content');
    if (placeholderContent) {
      placeholderContent.innerHTML = `
        <span class="placeholder-icon">❌</span>
        <p>Error generating video. Please try again.</p>
      `;
      placeholderContent.style.display = 'block';
    }
  }
}

startBtn.addEventListener('click', async () => {
  try {
    debug.log("Start button clicked");
    
    // First check if we have permission
    const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
    debug.log("Microphone permission status:", permissionStatus.state);
    
    if (permissionStatus.state === 'denied') {
      transcriptBox.textContent = "Microphone access denied. Please enable it in Chrome settings.";
      debug.error("Microphone permission denied");
      return;
    }

    audioContext = new AudioContext();
    debug.log("AudioContext created");

    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    debug.log("Got media stream");
    gumStream = stream;

    const input = audioContext.createMediaStreamSource(stream);
    debug.log("Created media stream source");
    
    recorder = new Recorder(input);
    recorder.record();
    debug.log("Started recording");

    transcriptBox.textContent = "Recording...";

    startBtn.disabled = true;
    stopBtn.disabled = false;
    
    updateStatus(transcriptStatus, transcriptStatusText, 'recording', 'Recording');
    updateStatus(aslStatus, aslStatusText, 'waiting', 'Waiting for speech');
  } catch (err) {
    debug.error("Error in start recording", err);
    if (err.name === 'NotAllowedError') {
      transcriptBox.textContent = "Microphone access denied. Please allow microphone access in Chrome settings.";
    } else if (err.name === 'NotFoundError') {
      transcriptBox.textContent = "No microphone found. Please connect a microphone and try again.";
    } else {
      transcriptBox.textContent = "Error accessing microphone: " + err.message;
    }
    aslAnimation.textContent = "Error accessing microphone";
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    debug.log("Stop button clicked");
    
    if (!recorder || !gumStream) {
      debug.error("Recorder or stream not initialized");
      return;
    }

    recorder.stop();
    gumStream.getAudioTracks().forEach(track => track.stop());
    debug.log("Stopped recording and tracks");

    transcriptBox.textContent = "Processing audio...";
    
    updateStatus(transcriptStatus, transcriptStatusText, 'processing', 'Processing');
    
    recorder.exportWAV(async (blob) => {
      try {
        debug.log("Exporting WAV");
        const formData = new FormData();
        formData.append('file', blob, 'audio.wav');

        debug.log("Sending to transcription API");
        const response = await fetch('https://flaskapispeech2text.onrender.com/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          debug.error("Server error", errorText);
          transcriptBox.textContent = `Server error: ${response.status}`;
          aslAnimation.textContent = "Error processing speech";
          
          updateStatus(transcriptStatus, transcriptStatusText, 'error', 'Error');
          updateStatus(aslStatus, aslStatusText, 'error', 'Error');
          return;
        }

        const data = await response.json();
        const transcription = data.transcription || "No speech detected.";
        transcriptBox.textContent = transcription;
        debug.log("Received transcription", transcription);
        
        updateStatus(transcriptStatus, transcriptStatusText, 'ready', 'Ready');

        await fetchVideo(transcription);
      } catch (err) {
        debug.error("Error in transcription process", err);
        transcriptBox.textContent = "Error transcribing speech.";
        aslAnimation.textContent = "Error in translation";
        
        updateStatus(transcriptStatus, transcriptStatusText, 'error', 'Error');
        updateStatus(aslStatus, aslStatusText, 'error', 'Error');
      }

      startBtn.disabled = false;
      stopBtn.disabled = true;
    });
  } catch (error) {
    debug.error("Error in stop recording", error);
  }
});

// Add browser recording functionality
const captureVideoBtn = document.getElementById("captureVideo");
const stopBrowserRecordingBtn = document.getElementById("stopBrowserRecording");
const audioLevelIndicator = document.querySelector(".audio-level-indicator");
const levelFill = document.querySelector(".level-fill");
const levelText = document.querySelector(".level-text");

let audioAnalyzer = null;
let audioSource = null;
let isBrowserRecording = false;

captureVideoBtn.addEventListener('click', async () => {
  try {
    debug.log("Capture browser button clicked");
    
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error("No active tab found");
    }

    // Show stop button and hide capture button
    stopBrowserRecordingBtn.style.display = 'block';
    captureVideoBtn.style.display = 'none';
    isBrowserRecording = true;

    // Update UI to show processing
    transcriptBox.textContent = "Capturing browser audio...";
    updateStatus(transcriptStatus, transcriptStatusText, 'processing', 'Processing');
    updateStatus(aslStatus, aslStatusText, 'waiting', 'Waiting for audio');

    // First, try to inject the content script if it's not already there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      debug.log("Content script injected");
    } catch (error) {
      debug.log("Content script already exists or injection failed", error);
    }

    // Wait a moment for the script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send message to content script
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'captureVideoAudio' });
    } catch (error) {
      debug.error("Error sending message to content script", error);
      throw new Error("Could not connect to the page. Please refresh the page and try again.");
    }
    
    if (response.error) {
      throw new Error(response.error);
    }

    // Convert ArrayBuffer to Blob
    const audioBlob = new Blob([response.audioData], { type: 'audio/webm' });
    
    // Create FormData and send to transcription API
    const formData = new FormData();
    formData.append('file', audioBlob, 'browser_audio.webm');

    transcriptBox.textContent = "Transcribing audio...";
    
    // Send to transcription API
    const transcriptionResponse = await fetch('https://flaskapispeech2text.onrender.com/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!transcriptionResponse.ok) {
      const errorText = await transcriptionResponse.text();
      debug.error("Server error", errorText);
      throw new Error(`Transcription failed: ${transcriptionResponse.status}`);
    }

    const data = await transcriptionResponse.json();
    const transcription = data.transcription || "No speech detected.";
    transcriptBox.textContent = transcription;
    
    updateStatus(transcriptStatus, transcriptStatusText, 'ready', 'Ready');

    // Convert to ASL
    transcriptBox.textContent = "Generating ASL video...";
    updateStatus(aslStatus, aslStatusText, 'processing', 'Processing');
    
    await fetchVideo(transcription);
    
  } catch (error) {
    debug.error("Error capturing browser audio", error);
    transcriptBox.textContent = `Error: ${error.message}`;
    updateStatus(transcriptStatus, transcriptStatusText, 'error', 'Error');
    updateStatus(aslStatus, aslStatusText, 'error', 'Error');
    
    // Reset UI state
    stopBrowserRecordingBtn.style.display = 'none';
    captureVideoBtn.style.display = 'block';
    isBrowserRecording = false;
  }
});

stopBrowserRecordingBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    // Send message to content script to stop recording
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
    
    if (response.error) {
      throw new Error(response.error);
    }

    // Reset UI state
    stopBrowserRecordingBtn.style.display = 'none';
    captureVideoBtn.style.display = 'block';
    isBrowserRecording = false;

    // Update status
    updateStatus(transcriptStatus, transcriptStatusText, 'processing', 'Processing');
    transcriptBox.textContent = "Processing audio...";
  } catch (error) {
    debug.error("Error stopping browser recording", error);
    transcriptBox.textContent = `Error: ${error.message}`;
    updateStatus(transcriptStatus, transcriptStatusText, 'error', 'Error');
  }
}); 