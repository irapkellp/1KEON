'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = 'OMSHAJ';

if (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET igomba kugira nibura inyuguti 32.');
}

const db = new DatabaseSync(
    process.env.DB_PATH || './omshaj.db'
);

db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT DEFAULT '',
        media_url TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        PRIMARY KEY(follower_id, following_id),
        FOREIGN KEY(follower_id) REFERENCES users(id)
            ON DELETE CASCADE,
        FOREIGN KEY(following_id) REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        PRIMARY KEY(user_id, post_id),
        FOREIGN KEY(user_id) REFERENCES users(id)
            ON DELETE CASCADE,
        FOREIGN KEY(post_id) REFERENCES posts(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
            ON DELETE CASCADE,
        FOREIGN KEY(post_id) REFERENCES posts(id)
            ON DELETE CASCADE
    );
`);

app.use(express.urlencoded({
    extended: false,
    limit: '100kb'
}));

app.use(express.json({ limit: '100kb' }));

app.use(session({
    name: 'omshaj.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function currentUser(req) {
    if (!req.session.userId) return null;

    return db.prepare(`
        SELECT id, username, email
        FROM users WHERE id = ?
    `).get(req.session.userId) || null;
}

function requireLogin(req, res, next) {
    if (!currentUser(req)) {
        return res.redirect('/login');
    }

    next();
}

function page(title, content, user = null) {
    const navigation = user
        ? `
            <a href="/">Home</a>
            <a href="/create">Create Post</a>
            <a href="/search">Search People</a>
            <a href="/logout">Logout</a>
          `
        : `
            <a href="/">Home</a>
            <a href="/login">Login</a>
            <a href="/register">Register</a>
          `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | OMSHAJ</title>
<style>
:root {
    --green: #087f3e;
    --yellow: #ffd629;
    --background: #f4f7f4;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: var(--background);
    color: #202820;
}
header {
    background: var(--green);
    color: white;
    padding: 16px;
    border-bottom: 5px solid var(--yellow);
}
header h1 { margin: 0 0 12px; }
nav { display: flex; gap: 14px; flex-wrap: wrap; }
nav a { color: white; text-decoration: none; font-weight: bold; }
main { max-width: 760px; margin: 22px auto; padding: 0 14px; }
.card {
    background: white;
    padding: 18px;
    margin-bottom: 16px;
    border-radius: 12px;
    box-shadow: 0 2px 8px #0000000c;
}
input, textarea, select, button {
    width: 100%;
    padding: 12px;
    margin: 7px 0;
    border: 1px solid #ccc;
    border-radius: 7px;
    font-size: 16px;
}
button, .button {
    background: var(--green);
    color: white;
    border: 0;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    padding: 12px;
    border-radius: 7px;
}
.media {
    display: block;
    max-width: 100%;
    max-height: 520px;
    margin: 12px 0;
    border-radius: 8px;
}
.muted { color: #666; font-size: 13px; }
footer { text-align: center; padding: 24px; }
</style>
</head>
<body>
<header>
    <h1>💚 OMSHAJ 💛</h1>
    <p>Connect, Share, and Discover.</p>
    <nav>${navigation}</nav>
</header>
<main>${content}</main>
<footer>OMSHAJ © ${new Date().getFullYear()}</footer>
</body>
</html>`;
}

function render(res, title, content, user = null) {
    res.send(page(title, content, user));
}

function message(res, text, user = null) {
    render(
        res,
        'Message',
        `<section class="card"><p>${escapeHtml(text)}</p>
        <a class="button" href="/">Back Home</a></section>`,
        user
    );
}

function csrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    return req.session.csrfToken;
}

function checkToken(req, res, next) {
    const submitted = req.body._token;
    const expected = req.session.csrfToken;

    if (
        typeof submitted !== 'string' ||
        typeof expected !== 'string' ||
        submitted.length !== expected.length ||
        !crypto.timingSafeEqual(
            Buffer.from(submitted),
            Buffer.from(expected)
        )
    ) {
        return res.status(403).send('Invalid request token. Refresh and retry.');
    }

    next();
}

function tokenField(req) {
    return `<input type="hidden" name="_token"
        value="${escapeHtml(csrfToken(req))}">`;
}

/* HOME AND FEED */

app.get('/', (req, res) => {
    const user = currentUser(req);

    const posts = db.prepare(`
        SELECT
            posts.*,
            users.username,
            (SELECT COUNT(*) FROM likes
             WHERE likes.post_id = posts.id) AS like_count,
            (SELECT COUNT(*) FROM comments
             WHERE comments.post_id = posts.id) AS comment_count
        FROM posts
        JOIN users ON users.id = posts.user_id
        ORDER BY posts.id DESC
        LIMIT 50
    `).all();

    const postHtml = posts.map(post => {
        let media = '';

        if (post.media_url && post.type === 'photo') {
            media = `<img class="media"
                src="${escapeHtml(post.media_url)}"
                alt="Post photo" loading="lazy">`;
        }

        if (post.media_url && post.type === 'video') {
            media = `<video class="media" controls
                src="${escapeHtml(post.media_url)}"></video>`;
        }

        if (post.media_url && post.type === 'audio') {
            media = `<audio class="media" controls
                src="${escapeHtml(post.media_url)}"></audio>`;
        }

        if (post.type === 'story') {
            media = `<div class="card">
                <strong>📖 STORY</strong>
                <p>${escapeHtml(post.content)}</p>
                ${post.media_url
                    ? `<a href="${escapeHtml(post.media_url)}"
                        target="_blank" rel="noopener">Open media</a>`
                    : ''}
            </div>`;
        }

        const likeButton = user ? `
            <form method="post" action="/like/${post.id}">
                ${tokenField(req)}
                <button type="submit">❤️ Like (${post.like_count})</button>
            </form>
        ` : `<p>❤️ ${post.like_count} likes</p>`;

        const commentForm = user ? `
            <form method="post" action="/comment/${post.id}">
                ${tokenField(req)}
                <input name="content" maxlength="1000"
                    placeholder="Write a comment..." required>
                <button type="submit">Comment</button>
            </form>
        ` : '';

        const comments = db.prepare(`
            SELECT comments.content, users.username
            FROM comments
            JOIN users ON users.id = comments.user_id
            WHERE comments.post_id = ?
            ORDER BY comments.id DESC
            LIMIT 5
        `).all(post.id).map(comment => `
            <p><strong>@${escapeHtml(comment.username)}</strong>:
            ${escapeHtml(comment.content)}</p>
        `).join('');

        return `
        <article class="card">
            <p><strong>@${escapeHtml(post.username)}</strong>
            <span class="muted"> · ${escapeHtml(post.type)}</span></p>
            <p>${escapeHtml(post.content)}</p>
            ${media}
            ${likeButton}
            <p>💬 ${post.comment_count} comments</p>
            ${comments}
            ${commentForm}
        </article>`;
    }).join('');

    render(res, 'Home', `
        ${user ? `
            <section class="card">
                <h2>Welcome, @${escapeHtml(user.username)}!</h2>
                <p>Share your world with OMSHAJ.</p>
                <a class="button" href="/create">＋ Create Post</a>
            </section>
        ` : `
            <section class="card">
                <h2>Welcome to OMSHAJ!</h2>
                <p>Connect, Share, and Discover.</p>
                <a class="button" href="/register">Join OMSHAJ</a>
            </section>
        `}
        <h2>Latest Posts</h2>
        ${postHtml || '<section class="card">No posts yet. Be the first to share!</section>'}
    `, user);
});

/* REGISTER */

app.get('/register', (req, res) => {
    render(res, 'Register', `
        <section class="card">
            <h2>Create Account</h2>
            <form method="post" action="/register">
                ${tokenField(req)}
                <input name="username" minlength="3" maxlength="24"
                    pattern="[A-Za-z0-9_]+" placeholder="Username"
                    autocomplete="username" required>
                <input name="email" type="email" maxlength="254"
                    placeholder="Email" autocomplete="email" required>
                <input name="password" type="password" minlength="10"
                    maxlength="72" placeholder="Password (10+ characters)"
                    autocomplete="new-password" required>
                <button type="submit">Register</button>
            </form>
        </section>
    `, currentUser(req));
});

app.post('/register', checkToken, async (req, res, next) => {
    try {
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
            return message(res, 'Username igomba kugira inyuguti 3–24.');
        }

        if (email.length > 254 || !email.includes('@')) {
            return message(res, 'Email ntabwo yemewe.');
        }

        if (password.length < 10 || password.length > 72) {
            return message(res, 'Password igomba kugira inyuguti 10–72.');
        }

        const hash = await bcrypt.hash(password, 12);

        db.prepare(`
            INSERT INTO users(username, email, password)
            VALUES (?, ?, ?)
        `).run(username, email, hash);

        res.redirect('/login');
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
            return message(res, 'Username cyangwa email isanzwe ikoreshwa.');
        }

        next(error);
    }
});

/* LOGIN */

app.get('/login', (req, res) => {
    render(res, 'Login', `
        <section class="card">
            <h2>Login</h2>
            <form method="post" action="/login">
                ${tokenField(req)}
                <input name="username" placeholder="Username or email"
                    autocomplete="username" required>
                <input name="password" type="password"
                    placeholder="Password" autocomplete="current-password"
                    required>
                <button type="submit">Login</button>
            </form>
        </section>
    `, currentUser(req));
});

app.post('/login', checkToken, async (req, res, next) => {
    try {
        const identity = String(req.body.username || '').trim();
        const password = String(req.body.password || '');

        const user = db.prepare(`
            SELECT * FROM users
            WHERE username = ? COLLATE NOCASE
               OR email = ? COLLATE NOCASE
        `).get(identity, identity);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return message(res, 'Login yanze. Reba username na password.');
        }

        req.session.regenerate(error => {
            if (error) return next(error);

            req.session.userId = user.id;
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');

            res.redirect('/');
        });
    } catch (error) {
        next(error);
    }
});

/* LOGOUT */

app.get('/logout', (req, res) => {
    render(res, 'Logout', `
        <section class="card">
            <h2>Logout</h2>
            <form method="post" action="/logout">
                ${tokenField(req)}
                <button type="submit">Confirm Logout</button>
            </form>
        </section>
    `, currentUser(req));
});

app.post('/logout', checkToken, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('omshaj.sid');
        res.redirect('/');
    });
});

/* CREATE POST */

app.get('/create', requireLogin, (req, res) => {
    render(res, 'Create Post', `
        <section class="card">
            <h2>Create a Post</h2>
            <p class="muted">
                In this initial version, use a publicly accessible media URL.
            </p>
            <form method="post" action="/create">
                ${tokenField(req)}
                <label>Post type</label>
                <select name="type" required>
                    <option value="text">Text</option>
                    <option value="story">Story</option>
                    <option value="photo">Photo</option>
                    <option value="audio">Audio</option>
                    <option value="video">Video</option>
                </select>
                <label>Text or caption</label>
                <textarea name="content" maxlength="5000"
                    placeholder="What would you like to share?"></textarea>
                <label>Media URL (for photo/audio/video, optional)</label>
                <input name="media_url" type="url" maxlength="2000"
                    placeholder="https://example.com/media">
                <button type="submit">Publish Post</button>
            </form>
        </section>
    `, currentUser(req));
});

app.post('/create', requireLogin, checkToken, (req, res) => {
    const type = String(req.body.type || '');
    const content = String(req.body.content || '').trim();
    const mediaUrl = String(req.body.media_url || '').trim();

    const allowedTypes = ['text', 'story', 'photo', 'audio', 'video'];

    if (!allowedTypes.includes(type)) {
        return message(res, 'Post type ntabwo yemewe.', currentUser(req));
    }

    if (!content && !mediaUrl) {
        return message(res, 'Andika ubutumwa cyangwa ushyiremo media URL.',
            currentUser(req));
    }

    if (content.length > 5000 || mediaUrl.length > 2000) {
        return message(res, 'Post irarenze ingano yemewe.', currentUser(req));
    }

    if (mediaUrl) {
        try {
            const url = new URL(mediaUrl);

            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('Invalid URL');
            }
        } catch {
            return message(res, 'Media URL ntabwo yemewe.', currentUser(req));
        }
    }

    db.prepare(`
        INSERT INTO posts(user_id, type, content, media_url)
        VALUES (?, ?, ?, ?)
    `).run(req.session.userId, type, content, mediaUrl);

    res.redirect('/');
});

/* LIKE */

app.post('/like/:id', requireLogin, checkToken, (req, res) => {
    const postId = Number(req.params.id);

    if (!Number.isSafeInteger(postId) || postId < 1) {
        return res.status(400).send('Invalid post ID.');
    }

    const post = db.prepare('SELECT id FROM posts WHERE id = ?')
        .get(postId);

    if (!post) {
        return res.status(404).send('Post ntiyabonetse.');
    }

    const existing = db.prepare(`
        SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?
    `).get(req.session.userId, postId);

    if (existing) {
        db.prepare(`
            DELETE FROM likes WHERE user_id = ? AND post_id = ?
        `).run(req.session.userId, postId);
    } else {
        db.prepare(`
            INSERT INTO likes(user_id, post_id) VALUES (?, ?)
        `).run(req.session.userId, postId);
    }

    res.redirect('/');
});

/* COMMENTS */

app.post('/comment/:id', requireLogin, checkToken, (req, res) => {
    const postId = Number(req.params.id);
    const content = String(req.body.content || '').trim();

    if (!Number.isSafeInteger(postId) || postId < 1 ||
        content.length < 1 || content.length > 1000) {
        return message(res, 'Comment ntabwo yemewe.', currentUser(req));
    }

    const post = db.prepare('SELECT id FROM posts WHERE id = ?')
        .get(postId);

    if (!post) {
        return res.status(404).send('Post ntiyabonetse.');
    }

    db.prepare(`
        INSERT INTO comments(user_id, post_id, content)
        VALUES (?, ?, ?)
    `).run(req.session.userId, postId, content);

    res.redirect('/');
});

/* SEARCH PEOPLE */

app.get('/search', (req, res) => {
    const user = currentUser(req);
    const query = String(req.query.q || '').trim().slice(0, 24);

    let results = [];

    if (query) {
        results = db.prepare(`
            SELECT id, username FROM users
            WHERE username LIKE ? ESCAPE '\\'
            ORDER BY username
            LIMIT 50
        `).all(
            '%' + query.replace(/[\\%_]/g, '\\$&') + '%'
        );
    }

    const people = results.map(person => `
        <div class="card">
            <strong>@${escapeHtml(person.username)}</strong>
            ${user && user.id !== person.id ? `
                <form method="post" action="/follow/${person.id}">
                    ${tokenField(req)}
                    <button type="submit">Follow / Unfollow</button>
                </form>
            ` : ''}
        </div>
    `).join('');

    render(res, 'Search', `
        <section class="card">
            <h2>Find People</h2>
            <form method="get" action="/search">
                <input name="q" value="${escapeHtml(query)}"
                    placeholder="Search username">
                <button type="submit">Search</button>
            </form>
        </section>
        ${people || (query ? '<p>No users found.</p>' : '')}
    `, user);
});

/* FOLLOW / UNFOLLOW */

app.post('/follow/:id', requireLogin, checkToken, (req, res) => {
    const targetId = Number(req.params.id);

    if (!Number.isSafeInteger(targetId) ||
        targetId < 1 ||
        targetId === req.session.userId) {
        return message(res, 'User ID ntabwo yemewe.', currentUser(req));
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?')
        .get(targetId);

    if (!target) {
        return res.status(404).send('User ntiyabonetse.');
    }

    const existing = db.prepare(`
        SELECT 1 FROM follows
        WHERE follower_id = ? AND following_id = ?
    `).get(req.session.userId, targetId);

    if (existing) {
        db.prepare(`
            DELETE FROM follows
            WHERE follower_id = ? AND following_id = ?
        `).run(req.session.userId, targetId);
    } else {
        db.prepare(`
            INSERT INTO follows(follower_id, following_id)
            VALUES (?, ?)
        `).run(req.session.userId, targetId);
    }

    res.redirect('/search');
});

/* HEALTH CHECK */

app.get('/health', (req, res) => {
    res.json({
        app: APP_NAME,
        status: 'ok',
        time: new Date().toISOString()
    });
});

/* 404 */

app.use((req, res) => {
    render(res, 'Not Found', `
        <section class="card">
            <h2>404 — Page Not Found</h2>
            <a class="button" href="/">Return Home</a>
        </section>
    `, currentUser(req));
});

/* ERROR HANDLER */

app.use((error, req, res, next) => {
    console.error('OMSHAJ error:', error);

    if (res.headersSent) return next(error);

    res.status(500).send(
        'OMSHAJ encountered a server error. Please try again later.'
    );
});

/* START SERVER */

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`OMSHAJ running on port ${PORT}`);
});

function shutdown() {
    server.close(() => {
        try {
            db.close();
        } finally {
            process.exit(0);
        }
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
