
const { GoogleGenAI } = require('@google/genai'); // Using destructuring
const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');
const passport = require('passport');
const SpotifyStrategy = require('passport-spotify').Strategy;
const axios = require('axios');
const path = require('path');

dotenv.config();
const app = express();

// Middleware
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json()); // to handle JSON in POST requests

app.use((err, req, res, next) => {
  console.error('Authentication error:', err);
  res.redirect('/?error=auth_failed');
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Passport Spotify OAuth config
passport.use(new SpotifyStrategy({
  clientID: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  callbackURL: process.env.REDIRECT_URI,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, expires_in, profile, done) => {
  try {
    // If profile isn't properly populated, fetch it manually
    if (!profile || !profile.id) {
      const { data } = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      profile = {
        id: data.id,
        displayName: data.display_name,
        photos: data.images,
        provider: 'spotify',
        _raw: JSON.stringify(data),
        _json: data
      };
    }
    return done(null, { accessToken, profile });
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Routes
app.get('/auth/spotify', passport.authenticate('spotify', {
  scope: [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-modify-public',
    'playlist-modify-private'
  ],
  showDialog: true
}));

app.get('/callback', passport.authenticate('spotify', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/profile.html');
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// API route to get profile + playlists
app.get('/api/me', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accessToken = req.user.accessToken;
    const userId = req.user.profile.id; // Added to get userId

    const [profileRes, playlistsRes] = await Promise.all([
      axios.get('https://api.spotify.com/v1/me', { // Corrected URL
        headers: { Authorization: `Bearer ${accessToken}` }
      }),
      axios.get(`https://api.spotify.com/v1/users/${userId}/playlists`, { // Corrected URL using userId
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    ]);

    res.json({
      profile: profileRes.data,
      playlists: playlistsRes.data.items
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch data from Spotify' });
  }
});

app.post('/api/create-playlist', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  const { name, description, public: isPublic } = req.body;
  const accessToken = req.user.accessToken;
  const userId = req.user.profile.id;

  try {
    const response = await axios.post(`https://api.spotify.com/v1/users/${userId}/playlists`, { // Corrected URL
      name,
      description,
      public: isPublic
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

app.get('/api/search-tracks', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  const query = req.query.q;
  const accessToken = req.user.accessToken;

  try {
    const response = await axios.get(`https://api.spotify.com/v1/search`, { // Corrected URL
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: query,
        type: 'track',
        limit: 5
      }
    });

    const tracks = response.data.tracks.items.map(t => ({
      name: t.name,
      artists: t.artists.map(a => a.name),
      uri: t.uri
    }));

    res.json(tracks);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/add-to-playlist', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  const { playlistId, trackUri, trackUris } = req.body;
  const uris = trackUris || (trackUri ? [trackUri] : []);
  const accessToken = req.user.accessToken;

  try {
    await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      uris
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to add track(s) to playlist' });
  }
});

app.post('/api/match-songs', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

  const { songs } = req.body;
  const accessToken = req.user.accessToken;

  try {
    const matched = [];

    for (const name of songs) {
      const searchRes = await axios.get(`https://api.spotify.com/v1/search`, { // Corrected URL
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        params: {
          q: name,
          type: 'track',
          limit: 1
        }
      });

      const track = searchRes.data.tracks.items[0];
      if (track) {
        matched.push({
          name: track.name,
          artists: track.artists.map(a => a.name),
          uri: track.uri
        });
      }
    }

    res.json(matched);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to match songs' });
  }
});

app.post('/api/gemini', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
      const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
      });
      console.log(req.body.prompt);
      const textResponse = response.text || "No response";
      res.json({ response: textResponse.replace(/\*\*|\*/g, '')});
      console.log(JSON.stringify(response, null, 2));

  } catch (err) {
      console.error("Gemini API Error:", err);
      res.status(500).json({ error: 'Failed to connect to Gemini' });
  }
});

app.listen(8000, () => {
  console.log(`Server running at http://127.0.0.1:8000/`);
});