window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();

    if (data.error) {
      document.body.innerHTML = '<h2 class="text-center mt-5 text-danger">Unauthorized. Please <a href="/">login again</a>.</h2>';
      return;
    }

    // Show user profile
    const profileHTML = `
      <div class="d-flex flex-column flex-md-row align-items-center gap-4">
        <img src="${data.profile.images[0]?.url || 'https://via.placeholder.com/150'}" 
             alt="Profile Picture" 
             class="rounded-circle shadow-sm" 
             width="120" height="120"
             style="object-fit: cover;">
        <div class="text-center text-md-start">
          <h3 class="mb-1 fw-semibold">${data.profile.display_name}</h3>
          <p class="mb-0">${data.profile.email}</p>
        </div>
      </div>
  `;
  document.getElementById('profile').innerHTML = profileHTML;

  } catch (err) {
    console.error(err);
    document.body.innerHTML = '<h2 class="text-center text-danger">Something went wrong loading your data.</h2>';
  }
});

let matchedTracks = []; // Store track URIs to add

document.getElementById('confirmAddBtn').addEventListener('click', async () => {
  const name = document.getElementById('playlistName').value;
  const description = document.getElementById('playlistDesc').value;
  const isPublic = document.getElementById('isPublic').checked;
  const matches = document.getElementById("matchedSongs");
  songList = matches.innerText.split('\n').map(track => track.trim()).filter(Boolean);

  if (!name) {
    document.getElementById('addStatus').textContent = '❌ Please enter a playlist name';
    return;
  }

  if (songList.length === 0) {
    document.getElementById('addStatus').textContent = '❌ No tracks to add';
    return;
  }

  showLoadingCreatingPlaylist('confirmAddBtn');

  const res = await fetch('/api/match-songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songs: songList })
  });

  const results = await res.json();
  matchedTracks = results.map(r => r.uri);



  try {
    // First create the playlist
    const createRes = await fetch('/api/create-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, public: isPublic })
    });

    const playlist = await createRes.json();

    if (!createRes.ok) {
      throw new Error(playlist.error || 'Failed to create playlist');
    }

    // Then add tracks to the new playlist
    const addRes = await fetch('/api/add-to-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: playlist.id, trackUris: matchedTracks })
    });

    const result = await addRes.json();
    const playlistUrl = playlist.external_urls?.spotify;

    const status = document.getElementById('addStatus');
    if (addRes.ok) {
      status.innerHTML = `✅ Playlist <strong>${playlist.name}</strong> created with ${matchedTracks.length} tracks!`;
      // Reset form
      document.getElementById('matchedSongs').innerHTML = '';
      document.getElementById('confirmAddBtn').style.display = 'none';
      document.getElementById('playlistLinkAnchor').href = playlistUrl;
      document.getElementById('playlistLinkAnchor').style.display = 'block';
      matchedTracks = [];
    } else {
      throw new Error(result.error || 'Failed to add tracks');
    }
  } catch (err) {
    console.error(err);
    document.getElementById('addStatus').textContent = `❌ Error: ${err.message}`;
  }
  hideLoadingCreatingPlaylist('confirmAddBtn');
});

let geminiConversationHistory = []; // Initialize history array

const prefixPrompt = 'You are a chatbot whose sole purpose is to suggest songs. In your response, only give the song names and artists. Do not say anything else and just give the song names. After every song put a <br>. The user prompt is: ';

document.getElementById('gemini-send').addEventListener('click', async () => {
  sendPrompt();
});

document.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); // Prevent default form submission
    sendPrompt();
  }
});

async function sendPrompt()
{
  const input = document.getElementById('gemini-input');
  const question = input.value.trim();

  if (!question) return;

  input.value = '';

  // Build the conversation
  if (geminiConversationHistory.length === 0) {
    // First message: prepend prefixPrompt with the user question
    const systemMessage = {
      role: "user",
      parts: [{ text: prefixPrompt + question }]
    };
    geminiConversationHistory.push(systemMessage);
  } else {
    // Regular follow-up message
    const userMessage = {
      role: "user",
      parts: [{ text: question }]
    };
    geminiConversationHistory.push(userMessage);
  }

  const contents = [...geminiConversationHistory];
  showTypingIndicator();
  try {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: contents })
    });

    const data = await res.json();

    if (data && data.response) {
      // Extract song list from response and populate bulkSongs textarea
      document.getElementById('matchedSongs').innerHTML = data.response.replace(/<br>/g, '\n').replace(/\n+/g, '\n').replace(/\n/g, '<br>').trim();      
      document.getElementById('confirmAddBtn').style.display = 'block';
    
      const modelResponse = {
        role: "model",
        parts: [{ text: data.response }]
      };

      geminiConversationHistory.push(modelResponse);
      hideTypingIndicator();
    } 
  } catch (error) {
    console.error("Fetch error:", error);
  }
}

// Function to show typing indicator
function showTypingIndicator() {
  const matchedSongsBox = document.getElementById('matchedSongs');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing-indicator';
  typingDiv.id = 'typing-indicator';
  typingDiv.innerHTML = '<span></span><span></span><span></span>';
  matchedSongsBox.appendChild(typingDiv);
}

// Function to hide typing indicator
function hideTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// Reusable loading functions
function showLoadingCreatingPlaylist(buttonId) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  
  // Store original button HTML if not already stored
  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }
  
  // Show spinner and disable button
  button.innerHTML = `
    <span class="spinner-border spinner-border-sm" role="status"></span>
  `;
  button.disabled = true;
}

function hideLoadingCreatingPlaylist(buttonId, restoreOriginal = true) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  
  if (restoreOriginal && button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
  }
  
  button.disabled = false;
}