![Alt text](/public/ividiyo.png "ividiyo logo")

## ividiyo Agents – P2P Video Modal

This is the **Agent Interface** for the **P2P Video Modal**, a real-time video calling system designed to help small businesses engage visitors and boost conversion. Built with **Vanilla JS**, **Vite**, and powered by **WebRTC** and **Momento**, this tool allows agents to respond to embedded video call requests from website users in real time.

> 🌱 Created for a spring-themed hackathon — because just like new businesses, relationships grow best with real, human connection.

---

## 🚀 Tech Stack

- ⚡️ Vite (Vanilla JS setup)
- 📡 WebRTC (P2P video)
- 💬 Momento Topics (signaling)
- 🧠 Momento Cache (session state)
- 🎨 Basic HTML/CSS

---
![image](https://github.com/user-attachments/assets/ea27d6db-e3bc-4dee-a9ab-b82b6d17ded5)
![image](https://github.com/user-attachments/assets/ff19038d-5267-4511-aa29-57630d486ed1)

## 📁 Project Structure

```bash
agent/
├── index.html             # Agent UI
├── main.js                # Entry point
├── signaling.js           # WebRTC signaling via Momento Topics
├── cache.js               # Session handling via Momento Cache
├── styles.css             # Basic styling
├── vite.config.js         # Vite configuration
└── .env                   # Auth config for Momento
