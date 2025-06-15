// Notify that the content script is loaded
console.log('ASL Web Translator content script loaded');

let mediaRecorder = null;
let audioContext = null;
let audioSource = null;
let audioDestination = null;
let targetVideo = null;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'captureVideoAudio') {
    captureVideoAudio().then(sendResponse).catch(error => {
      console.error('Error in captureVideoAudio:', error);
      sendResponse({ error: error.message });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'stopRecording') {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log('Stopping recording on request');
      mediaRecorder.stop();
      cleanupAudioContext();
      sendResponse({ success: true });
    } else {
      sendResponse({ error: 'No active recording to stop' });
    }
    return true;
  }
});

function cleanupAudioContext() {
  console.log('Cleaning up audio context');
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  if (audioDestination) {
    audioDestination.disconnect();
    audioDestination = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaRecorder) {
    mediaRecorder = null;
  }
  targetVideo = null;
}

async function captureVideoAudio() {
  try {
    console.log('Starting video audio capture');
    
    // Clean up any existing audio context first
    cleanupAudioContext();
    
    // Find all video elements on the page
    const videos = document.querySelectorAll('video');
    console.log('Found videos:', videos.length);
    
    if (videos.length === 0) {
      throw new Error('No video found on this page');
    }

    // Get the first playing video or the first video if none are playing
    targetVideo = Array.from(videos).find(v => !v.paused) || videos[0];
    console.log('Selected video:', {
      playing: !targetVideo.paused,
      duration: targetVideo.duration,
      currentTime: targetVideo.currentTime
    });

    // Create new audio context
    audioContext = new AudioContext();
    
    // Get audio stream
    let audioStream;
    if (targetVideo.captureStream) {
      audioStream = targetVideo.captureStream();
    } else {
      // Fallback to MediaElementSource
      try {
        audioSource = audioContext.createMediaElementSource(targetVideo);
        audioDestination = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDestination);
        audioSource.connect(audioContext.destination);
        audioStream = audioDestination.stream;
      } catch (error) {
        if (error.name === 'InvalidStateError') {
          throw new Error('This video is already being captured. Please stop the current recording first.');
        }
        throw error;
      }
    }

    // Create a MediaRecorder for audio only
    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    
    const audioChunks = [];

    return new Promise((resolve) => {
      mediaRecorder.ondataavailable = (event) => {
        console.log('Received audio chunk');
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('Audio data read complete');
          resolve({
            audioData: reader.result,
            videoTitle: document.title,
            duration: targetVideo.duration
          });
        };
        reader.readAsArrayBuffer(audioBlob);
      };

      // Start recording
      console.log('Starting MediaRecorder');
      mediaRecorder.start();

      // Stop recording after 10 seconds or when video ends
      const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          console.log('Stopping MediaRecorder');
          mediaRecorder.stop();
          targetVideo.removeEventListener('ended', stopRecording);
          cleanupAudioContext();
        }
      };

      // Stop after 10 seconds
      setTimeout(stopRecording, 10000);
      
      // Or stop when video ends
      targetVideo.addEventListener('ended', stopRecording);
    });
  } catch (error) {
    console.error('Error capturing video audio:', error);
    cleanupAudioContext();
    throw error;
  }
} 