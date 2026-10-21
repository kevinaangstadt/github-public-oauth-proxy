# GitHub OAuth Token Exchange Proxy

A minimal, secure, containerized OAuth token exchange proxy designed for front-end web development assignments. 

It solves two primary challenges when working with the GitHub API on client-only web pages:
1. **Rate Limiting:** Unauthenticated requests to GitHub are capped at 60 req/hr per IP address (a single shared classroom Wi-Fi network will exhaust this quickly). Authenticated requests raise this limit to 5,000 req/hr.
2. **CORS on Token Exchange:** GitHub's OAuth access token endpoint (`https://github.com/login/oauth/access_token`) does not send CORS headers, preventing direct in-browser token swaps. This proxy performs the server-to-server token exchange securely while returning permissive CORS headers for local loopback development (`127.0.0.1` and `localhost`).

---

## Architecture Overview

```
[Browser: 127.0.0.1 / localhost]
        │
        │ 1. Redirect to GitHub OAuth consent screen
        ▼
[GitHub Authorization Server]
        │
        │ 2. Redirect back with ?code=12345
        ▼
[Browser: 127.0.0.1 / localhost]
        │
        │ 3. POST /authenticate { code: "12345" }
        ▼
[Cloud Run Proxy (This Container)]
        │
        │ 4. Server-to-server POST with CLIENT_SECRET
        ▼
[GitHub OAuth API]
        │
        │ 5. Returns access token
        ▼
[Cloud Run Proxy]
        │
        │ 6. Validates scopes & returns JSON with CORS
        ▼
[Browser: 127.0.0.1 / localhost]
        │
        │ 7. Query api.github.com using Bearer token (5,000 req/hr)
        ▼
[GitHub REST API]
```

---

## Security Features

- **CORS Whitelist:** Locked down to loopback addresses (`http://127.0.0.1:*` and `http://localhost:*`) to prevent unauthorized domains from using the proxy.
- **POST-Only Authentication:** Accepts authentication codes via HTTP `POST` body rather than `GET` query parameters to prevent code leakage in access logs.
- **Scope Restriction:** Rejects tokens containing excessive privileges (e.g., repository write access) to prevent accidental high-privilege token exposure on front-end clients.

---

## Repository Structure

```
├── .github/
│   └── workflows/
│       └── docker-publish.yml   # Automated GitHub Actions build & push to Docker Hub
├── .dockerignore
├── Dockerfile                   # Node 20 LTS minimal Alpine container
├── package.json
├── README.md
└── server.js                    # Express proxy with CORS and scope controls
```

---

## Instructor Setup (Automated Docker Hub Builds)

This repository includes a GitHub Action workflow to build and push container images to Docker Hub whenever changes are merged into `main`.

### 1. Docker Hub Configuration
1. Log in to [Docker Hub](https://hub.docker.com/).
2. Create a repository named `github-auth-proxy` (set visibility to **Public**).
3. Navigate to **Account Settings** → **Security** → **New Access Token**.
4. Grant **Read & Write** access and copy the generated token.

### 2. GitHub Secrets
In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**, and create two repository secrets:
- `DOCKERHUB_USERNAME`: Your Docker Hub username.
- `DOCKERHUB_TOKEN`: The Docker Hub access token generated above.

Pushing to `main` will build the image and push it to:
```text
docker.io/<your-dockerhub-username>/github-auth-proxy:latest
```

---

## Student Instructions: Deploying to Google Cloud Run

Students do not need Docker or command-line cloud tools installed. They can deploy the proxy directly using the Google Cloud web interface.

### Step 1: Create a GitHub OAuth App
1. Go to your GitHub profile → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Fill in the fields:
   - **Application name:** `Class-Repo-Viewer` (or your choice)
   - **Homepage URL:** `http://127.0.0.1:5500` (or whatever local port your server uses)
   - **Authorization callback URL:** `http://127.0.0.1:5500`
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy the **Client Secret**.

### Step 2: Deploy Container on Google Cloud Run
1. Log in to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your class project and search for **Cloud Run** in the search bar.
3. Click **Create Service**.
4. Configure the service:
   - Select **Deploy one revision from an existing container image**.
   - **Container image URL:** 
     ```text
     docker.io/<your-dockerhub-username>/github-auth-proxy:latest
     ```
   - **Service name:** `github-auth-proxy`
   - **Region:** Choose a nearby region (e.g., `us-central1`).
   - **Authentication:** Select **Allow unauthenticated invocations**.
5. Expand **Container, Variables & Secrets, Connections, Security**:
   - Under **Variables**, add two environment variables:
     - `GITHUB_CLIENT_ID`: *(Paste your GitHub Client ID)*
     - `GITHUB_CLIENT_SECRET`: *(Paste your GitHub Client Secret)*
6. Click **Create**.
7. Once deployed, copy the generated **Service URL** (e.g., `https://github-auth-proxy-abc123-uc.a.run.app`).

---

## Front-End Usage Example

### 1. Redirect to GitHub for Authorization

In your front-end code (e.g., index.html / app.js), send the user to GitHub. Leave `scope` empty to request public access only:

```javascript
const CLIENT_ID = 'YOUR_GITHUB_CLIENT_ID';
const REDIRECT_URI = window.location.origin;

document.getElementById('login-btn').addEventListener('click', () => {
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  window.location.href = authUrl;
});
```

### 2. Handle Redirect and Exchange Token via Proxy

When GitHub redirects back to your local server with `?code=...`:

```javascript
const PROXY_URL = 'https://YOUR_CLOUD_RUN_SERVICE_URL.a.run.app/authenticate';

async function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (!code) return;

  // Clean the URL bar so the code isn't reused or visible
  window.history.replaceState({}, document.title, window.location.pathname);

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    const data = await res.json();

    if (data.access_token) {
      sessionStorage.setItem('gh_token', data.access_token);
      console.log('Successfully authenticated!');
      loadRepositories('octocat');
    } else {
      console.error('Authentication failed:', data);
    }
  } catch (err) {
    console.error('Network error during authentication:', err);
  }
}

// 3. Query the GitHub API with 5,000 requests/hour
async function loadRepositories(username) {
  const token = sessionStorage.getItem('gh_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(`https://api.github.com/users/${username}/repos`, { headers });
  const repos = await res.json();
  console.log('Repositories:', repos);
}

handleOAuthCallback();
```

---

## Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GITHUB_CLIENT_ID` | **Yes** | Client ID of the registered GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | **Yes** | Client Secret of the registered GitHub OAuth App |
| `PORT` | No | Listening port for the HTTP server (defaults to `8080` for Cloud Run) |

---

## License

BSD 3-Clause License. See [LICENSE](LICENSE.txt) for details.