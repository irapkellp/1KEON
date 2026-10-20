/* DATABASE TABLES */

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


/* REQUEST MIDDLEWARE */

app.use(express.urlencoded({
    extended: false,
    limit: '100kb'
}));

app.use(express.json({
    limit: '100kb'
}));

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


/* HTML ESCAPING */

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}


/* CURRENT USER */

function currentUser(req) {
    if (!req.session.userId) {
        return null;
    }

    return db.prepare(`
        SELECT id, username, email
        FROM users
        WHERE id = ?
    `).get(req.session.userId) || null;
}


/* REQUIRE LOGIN */

function requireLogin(req, res, next) {
    if (!currentUser(req)) {
        return res.redirect('/login');
    }

    next();
}


/* PAGE TEMPLATE */

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

<meta
    name="viewport"
    content="width=device-width, initial-scale=1"
>

<title>${escapeHtml(title)} | 1KEON</title>

<style>
:root {
    --green: #087f3e;
    --yellow: #ffd629;
    --background: #f4f7f4;
    --text: #202820;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: var(--background);
    color: var(--text);
}

header {
    background: var(--green);
    color: white;
    padding: 16px;
    border-bottom: 5px solid var(--yellow);
}

header h1 {
    margin: 0 0 12px;
}

nav {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
}

nav a {
    color: white;
    text-decoration: none;
    font-weight: bold;
}

nav a:hover {
    text-decoration: underline;
}

main {
    max-width: 760px;
    margin: 22px auto;
    padding: 0 14px;
}

.card {
    background: white;
    padding: 18px;
    margin-bottom: 16px;
    border-radius: 12px;
    box-shadow: 0 2px 8px #0000000c;
}

input,
textarea,
select,
button {
    width: 100%;
    padding: 12px;
    margin: 7px 0;
    border: 1px solid #ccc;
    border-radius: 7px;
    font-size: 16px;
}

textarea {
    min-height: 100px;
    resize: vertical;
}

button,
.button {
    background: var(--green);
    color: white;
    border: 0;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    padding: 12px;
    border-radius: 7px;
}

button:hover,
.button:hover {
    opacity: 0.9;
}

.media {
    display: block;
    max-width: 100%;
    max-height: 520px;
    margin: 12px 0;
    border-radius: 8px;
}

video.media {
    width: 100%;
    background: #000;
}

audio.media {
    width: 100%;
}

.muted {
    color: #666;
    font-size: 13px;
}

footer {
    text-align: center;
    padding: 24px;
}

@media (max-width: 480px) {
    header {
        padding: 12px;
    }

    nav {
        gap: 10px;
    }

    main {
        margin-top: 14px;
    }

    .card {
        padding: 14px;
    }
}
</style>
</head>

<body>

<header>
    <h1>💚 1KEON 💛</h1>

    <p>Connect, Share, and Discover.</p>

    <nav>
        ${navigation}
    </nav>
</header>

<main>
    ${content}
</main>

<footer>
    1KEON © ${new Date().getFullYear()}
</footer>

</body>
</html>`;
}


/* RENDER PAGE */

function render(res, title, content, user = null) {
    res.send(page(title, content, user));
}


/* DISPLAY MESSAGE */

function message(res, text, user = null) {
    render(
        res,
        'Message',
        `
        <section class="card">
            <p>${escapeHtml(text)}</p>

            <a class="button" href="/">
                Back Home
            </a>
        </section>
        `,
        user
    );
}


/* CSRF PROTECTION */

function csrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken =
            crypto.randomBytes(32).toString('hex');
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
        return res.status(403).send(
            'Invalid request token. Refresh and retry.'
        );
    }

    next();
}


function tokenField(req) {
    return `
        <input
            type="hidden"
            name="_token"
            value="${escapeHtml(csrfToken(req))}"
        >
    `;
}


/* HOME AND FEED */

app.get('/', (req, res) => {
    const user = currentUser(req);

    const posts = db.prepare(`
        SELECT
            posts.*,
            users.username,

            (
                SELECT COUNT(*)
                FROM likes
                WHERE likes.post_id = posts.id
            ) AS like_count,

            (
                SELECT COUNT(*)
                FROM comments
                WHERE comments.post_id = posts.id
            ) AS comment_count

        FROM posts

        JOIN users
            ON users.id = posts.user_id

        ORDER BY posts.id DESC

        LIMIT 50
    `).all();


    const postHtml = posts.map(post => {
        let media = '';

        if (post.media_url && post.type === 'photo') {
            media = `
                <img
                    class="media"
                    src="${escapeHtml(post.media_url)}"
                    alt="Post photo"
                    loading="lazy"
                >
            `;
        }

        if (post.media_url && post.type === 'video') {
            media = `
                <video
                    class="media"
                    controls
                    playsinline
                    preload="metadata"
                    src="${escapeHtml(post.media_url)}"
                ></video>
            `;
        }

        if (post.media_url && post.type === 'audio') {
            media = `
                <audio
                    class="media"
                    controls
                    src="${escapeHtml(post.media_url)}"
                ></audio>
            `;
        }

        if (post.type === 'story') {
            media = `
                <div class="card">
                    <strong>📖 STORY</strong>

                    <p>${escapeHtml(post.content)}</p>

                    ${post.media_url ? `
                        <a
                            href="${escapeHtml(post.media_url)}"
                            target="_blank"
                            rel="noopener"
                        >
                            Open media
                        </a>
                    ` : ''}
                </div>
            `;
        }


        const likeButton = user
            ? `
                <form
                    method="post"
                    action="/like/${post.id}"
                >
                    ${tokenField(req)}

                    <button type="submit">
                        ❤️ Like (${post.like_count})
                    </button>
                </form>
            `
            : `
                <p>❤️ ${post.like_count} likes</p>
            `;


        const commentForm = user
            ? `
                <form
                    method="post"
                    action="/comment/${post.id}"
                >
                    ${tokenField(req)}

                    <input
                        name="content"
                        maxlength="1000"
                        placeholder="Write a comment..."
                        required
                    >

                    <button type="submit">
                        Comment
                    </button>
                </form>
            `
            : '';


        const comments = db.prepare(`
            SELECT
                comments.content,
                users.username

            FROM comments

            JOIN users
                ON users.id = comments.user_id

            WHERE comments.post_id = ?

            ORDER BY comments.id DESC

            LIMIT 5
        `).all(post.id).map(comment => `
            <p>
                <strong>
                    @${escapeHtml(comment.username)}
                </strong>:

                ${escapeHtml(comment.content)}
            </p>
        `).join('');


        return `
            <article class="card">

                <p>
                    <strong>
                        @${escapeHtml(post.username)}
                    </strong>

                    <span class="muted">
                        · ${escapeHtml(post.type)}
                    </span>
                </p>

                <p>
                    ${escapeHtml(post.content)}
                </p>

                ${media}

                ${likeButton}

                <p>
                    💬 ${post.comment_count} comments
                </p>

                ${comments}

                ${commentForm}

            </article>
        `;
    }).join('');


    render(
        res,
        'Home',
        `
        ${user ? `
            <section class="card">

                <h2>
                    Welcome, @${escapeHtml(user.username)}!
                </h2>

                <p>
                    Share your world with 1KEON.
                </p>

                <a class="button" href="/create">
                    ＋ Create Post
                </a>

            </section>
        ` : `
            <section class="card">

                <h2>
                    Welcome to 1KEON!
                </h2>

                <p>
                    Connect, Share, and Discover.
                </p>

                <a class="button" href="/register">
                    Join 1KEON
                </a>

            </section>
        `}

        <h2>Latest Posts</h2>

        ${postHtml || `
            <section class="card">
                No posts yet. Be the first to share!
            </section>
        `}
        `,
        user
    );
});
/* ================================
   REGISTER — KWANDIKISHA KONTI
================================ */

app.get('/register', (req, res) => {
    render(res, 'Create Account', `
        <section class="card">
            <h2>Join 1KEON</h2>

            <form method="post" action="/register">
                ${tokenField(req)}

                <label>Username</label>
                <input
                    type="text"
                    name="username"
                    minlength="3"
                    maxlength="30"
                    required
                    autocomplete="username"
                    placeholder="Hitamo username"
                >

                <label>Email</label>
                <input
                    type="email"
                    name="email"
                    maxlength="254"
                    required
                    autocomplete="email"
                    placeholder="Andika email yawe"
                >

                <label>Password</label>
                <input
                    type="password"
                    name="password"
                    minlength="8"
                    maxlength="128"
                    required
                    autocomplete="new-password"
                    placeholder="Nibura inyuguti 8"
                >

                <button type="submit">Create Account</button>
            </form>

            <p>
                Usanzwe ufite konti?
                <a href="/login">Injira hano</a>
            </p>
        </section>
    `, currentUser(req));
});

app.post('/register', checkToken, (req, res, next) => {
    try {
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '')
            .trim()
            .toLowerCase();
        const password = String(req.body.password || '');

        if (
            username.length < 3 ||
            username.length > 30 ||
            !/^[a-zA-Z0-9_.-]+$/.test(username)
        ) {
            return message(
                res,
                'Ikosa',
                'Username igomba kugira inyuguti 3–30, imibare, utudomo cyangwa uturongo gusa.',
                currentUser(req)
            );
        }

        if (
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return message(
                res,
                'Ikosa',
                'Andika email nyayo.',
                currentUser(req)
            );
        }

        if (password.length < 8 || password.length > 128) {
            return message(
                res,
                'Ikosa',
                'Password igomba kugira inyuguti nibura 8 kandi ntirenze 128.',
                currentUser(req)
            );
        }

        const existing = db.prepare(`
            SELECT id
            FROM users
            WHERE lower(username) = lower(?)
               OR lower(email) = lower(?)
            LIMIT 1
        `).get(username, email);

        if (existing) {
            return message(
                res,
                'Konti irahari',
                'Username cyangwa email byamaze gukoreshwa. Gerageza ibindi.',
                currentUser(req)
            );
        }

        const passwordHash = bcrypt.hashSync(password, 12);

        const result = db.prepare(`
            INSERT INTO users (
                username,
                email,
                password_hash
            )
            VALUES (?, ?, ?)
        `).run(username, email, passwordHash);

        req.session.regenerate((err) => {
            if (err) return next(err);

            req.session.userId = Number(result.lastInsertRowid);

            req.session.save((saveErr) => {
                if (saveErr) return next(saveErr);
                return res.redirect('/');
            });
        });
    } catch (err) {
        if (
            err &&
            (
                String(err.message).includes('UNIQUE constraint failed') ||
                String(err.message).includes('SQLITE_CONSTRAINT')
            )
        ) {
            return message(
                res,
                'Konti irahari',
                'Iyo username cyangwa email irakoreshwa. Gerageza ibindi.',
                currentUser(req)
            );
        }

        next(err);
    }
});


/* ================================
   LOGIN — KWINJIRA
================================ */

app.get('/login', (req, res) => {
    render(res, 'Login', `
        <section class="card">
            <h2>Login to 1KEON</h2>

            <form method="post" action="/login">
                ${tokenField(req)}

                <label>Email cyangwa Username</label>
                <input
                    type="text"
                    name="identity"
                    required
                    maxlength="254"
                    autocomplete="username"
                    placeholder="Email cyangwa username"
                >

                <label>Password</label>
                <input
                    type="password"
                    name="password"
                    required
                    maxlength="128"
                    autocomplete="current-password"
                    placeholder="Password yawe"
                >

                <button type="submit">Login</button>
            </form>

            <p>
                Nta konti ufite?
                <a href="/register">Iyandikishe hano</a>
            </p>
        </section>
    `, currentUser(req));
});

app.post('/login', checkToken, (req, res, next) => {
    try {
        const identity = String(req.body.identity || '').trim();
        const password = String(req.body.password || '');

        if (!identity || !password) {
            return message(
                res,
                'Login',
                'Uzuza username cyangwa email na password.',
                currentUser(req)
            );
        }

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE lower(username) = lower(?)
               OR lower(email) = lower(?)
            LIMIT 1
        `).get(identity, identity);

        if (
            !user ||
            !bcrypt.compareSync(password, user.password_hash)
        ) {
            return message(
                res,
                'Login yanze',
                'Username, email cyangwa password si byo.',
                null
            );
        }

        req.session.regenerate((err) => {
            if (err) return next(err);

            req.session.userId = user.id;

            req.session.save((saveErr) => {
                if (saveErr) return next(saveErr);
                return res.redirect('/');
            });
        });
    } catch (err) {
        next(err);
    }
});


/* ================================
   LOGOUT — GUSOHOKA
================================ */

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }

        res.clearCookie('omshaj.sid');
        return res.redirect('/login');
    });
});

app.post('/logout', checkToken, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }

        res.clearCookie('omshaj.sid');
        return res.redirect('/login');
    });
});


/* ================================
   CREATE POST — FORM
================================ */

app.get('/create', requireLogin, (req, res) => {
    render(res, 'Create Post', `
        <section class="card">
            <h2>Create a Post</h2>

            <p>
                Sangiza ubutumwa, story, ifoto cyangwa video.
            </p>

            <form
                method="post"
                action="/create"
                enctype="multipart/form-data"
            >
                ${tokenField(req)}

                <label>Post type</label>

                <select name="type" required>
                    <option value="text">Text</option>
                    <option value="story">Story</option>
                    <option value="photo">Photo</option>
                    <option value="audio">Audio stream</option>
                    <option value="video">Video</option>
                </select>

                <label>Text cyangwa caption</label>

                <textarea
                    name="content"
                    maxlength="5000"
                    placeholder="Andika ibyo ushaka gusangiza abandi..."
                ></textarea>

                <label>Hitamo ifoto cyangwa video muri telefone</label>

                <input
                    name="media"
                    type="file"
                    accept="image/*,video/*"
                >

                <p class="muted">
                    Ushobora guhitamo ifoto cyangwa video muri Gallery ya telefone.
                    Ingano ntigomba kurenza 50 MB.
                </p>

                <label>Media URL (optional)</label>

                <input
                    name="media_url"
                    type="url"
                    maxlength="2000"
                    placeholder="https://example.com/media"
                >

                <button type="submit">Publish Post</button>
            </form>
        </section>
    `, currentUser(req));
});


/* ================================
   CREATE POST — SAVE
================================ */

app.post(
    '/create',
    requireLogin,
    upload.single('media'),
    checkToken,
    (req, res, next) => {
        let uploadedFile = req.file || null;

        try {
            const type = String(req.body.type || '').trim();

            const content = String(
                req.body.content || ''
            ).trim();

            const enteredMediaUrl = String(
                req.body.media_url || ''
            ).trim();

            const allowedTypes = [
                'text',
                'story',
                'photo',
                'audio',
                'video'
            ];

            if (!allowedTypes.includes(type)) {
                if (uploadedFile) {
                    fs.unlink(uploadedFile.path, () => {});
                }

                return message(
                    res,
                    'Ikosa',
                    'Hitamo ubwoko bwa post bwemewe.',
                    currentUser(req)
                );
            }

            if (content.length > 5000) {
                if (uploadedFile) {
                    fs.unlink(uploadedFile.path, () => {});
                }

                return message(
                    res,
                    'Ikosa',
                    'Ubutumwa ntibugomba kurenza inyuguti 5000.',
                    currentUser(req)
                );
            }

            if (enteredMediaUrl.length > 2000) {
                if (uploadedFile) {
                    fs.unlink(uploadedFile.path, () => {});
                }

                return message(
                    res,
                    'Ikosa',
                    'Media URL ni ndende cyane.',
                    currentUser(req)
                );
            }

            if (!content && !enteredMediaUrl && !uploadedFile) {
                return message(
                    res,
                    'Post irimo ubusa',
                    'Andika ubutumwa cyangwa uhitemo ifoto/video.',
                    currentUser(req)
                );
            }

            /*
             * PHOTO / VIDEO UPLOAD
             */

            if (uploadedFile) {
                const isImage = uploadedFile.mimetype.startsWith('image/');
                const isVideo = uploadedFile.mimetype.startsWith('video/');

                if (!isImage && !isVideo) {
                    fs.unlink(uploadedFile.path, () => {});

                    return message(
                        res,
                        'Ikosa',
                        'Ushobora kohereza amafoto na video gusa.',
                        currentUser(req)
                    );
                }

                if (type === 'photo' && !isImage) {
                    fs.unlink(uploadedFile.path, () => {});

                    return message(
                        res,
                        'Ikosa',
                        'Wahisemo Photo. Hitamo ifoto, cyangwa uhindure Post type ibe Video.',
                        currentUser(req)
                    );
                }

                if (type === 'video' && !isVideo) {
                    fs.unlink(uploadedFile.path, () => {});

                    return message(
                        res,
                        'Ikosa',
                        'Wahisemo Video. Hitamo video, cyangwa uhindure Post type ibe Photo.',
                        currentUser(req)
                    );
                }

                if (
                    !['photo', 'video'].includes(type)
                ) {
                    fs.unlink(uploadedFile.path, () => {});

                    return message(
                        res,
                        'Hitamo Post type',
                        'Ifoto cyangwa video bigomba kugira ubwoko bwa Photo cyangwa Video.',
                        currentUser(req)
                    );
                }
            }

            /*
             * VALIDATE OPTIONAL EXTERNAL URL
             */

            if (enteredMediaUrl && !uploadedFile) {
                let parsedUrl;

                try {
                    parsedUrl = new URL(enteredMediaUrl);
                } catch {
                    return message(
                        res,
                        'URL si yo',
                        'Andika URL yuzuye itangirana na https:// cyangwa http://.',
                        currentUser(req)
                    );
                }

                if (
                    !['http:', 'https:'].includes(parsedUrl.protocol)
                ) {
                    return message(
                        res,
                        'URL ntiyemewe',
                        'Media URL igomba gukoresha HTTP cyangwa HTTPS.',
                        currentUser(req)
                    );
                }
            }

            /*
             * FILE URL OR EXTERNAL URL
             */

            const mediaUrl = uploadedFile
                ? '/uploads/' + uploadedFile.filename
                : (enteredMediaUrl || null);

            /*
             * KEEP THE EXISTING DATABASE STRUCTURE
             */

            const result = db.prepare(`
                INSERT INTO posts (
                    user_id,
                    type,
                    content,
                    media_url
                )
                VALUES (?, ?, ?, ?)
            `).run(
                req.session.userId,
                type,
                content,
                mediaUrl
            );

            return res.redirect('/');

        } catch (err) {
            if (uploadedFile) {
                fs.unlink(uploadedFile.path, () => {});
            }

            return next(err);
        }
    }
);
/* =========================================
   LIKE / UNLIKE POSTS
========================================= */

app.post(
    '/posts/:id/like',
    requireLogin,
    checkToken,
    (req, res, next) => {
        try {
            const postId = Number(req.params.id);

            if (!Number.isSafeInteger(postId) || postId <= 0) {
                return message(
                    res,
                    'Ikosa',
                    'Post wasabwe ntiboneka.',
                    currentUser(req)
                );
            }

            const post = db.prepare(`
                SELECT id
                FROM posts
                WHERE id = ?
            `).get(postId);

            if (!post) {
                return message(
                    res,
                    'Post ntiboneka',
                    'Iyi post ishobora kuba yarasibwe.',
                    currentUser(req)
                );
            }

            const existingLike = db.prepare(`
                SELECT id
                FROM likes
                WHERE user_id = ? AND post_id = ?
            `).get(req.session.userId, postId);

            if (existingLike) {
                db.prepare(`
                    DELETE FROM likes
                    WHERE user_id = ? AND post_id = ?
                `).run(req.session.userId, postId);
            } else {
                db.prepare(`
                    INSERT INTO likes (user_id, post_id)
                    VALUES (?, ?)
                `).run(req.session.userId, postId);
            }

            return res.redirect('/');

        } catch (err) {
            return next(err);
        }
    }
);


/* =========================================
   ADD COMMENT
========================================= */

app.post(
    '/posts/:id/comment',
    requireLogin,
    checkToken,
    (req, res, next) => {
        try {
            const postId = Number(req.params.id);
            const content = String(
                req.body.content || ''
            ).trim();

            if (!Number.isSafeInteger(postId) || postId <= 0) {
                return message(
                    res,
                    'Ikosa',
                    'Post wasabwe ntiboneka.',
                    currentUser(req)
                );
            }

            if (!content || content.length > 2000) {
                return message(
                    res,
                    'Comment',
                    'Comment igomba kugira inyuguti 1–2000.',
                    currentUser(req)
                );
            }

            const post = db.prepare(`
                SELECT id
                FROM posts
                WHERE id = ?
            `).get(postId);

            if (!post) {
                return message(
                    res,
                    'Post ntiboneka',
                    'Iyi post ntikiboneka.',
                    currentUser(req)
                );
            }

            db.prepare(`
                INSERT INTO comments (
                    user_id,
                    post_id,
                    content
                )
                VALUES (?, ?, ?)
            `).run(
                req.session.userId,
                postId,
                content
            );

            return res.redirect('/');

        } catch (err) {
            return next(err);
        }
    }
);


/* =========================================
   SEARCH PEOPLE
========================================= */

app.get('/search', (req, res) => {
    const query = String(req.query.q || '').trim();
    let results = [];

    if (query.length > 0 && query.length <= 100) {
        results = db.prepare(`
            SELECT
                users.id,
                users.username,
                (
                    SELECT COUNT(*)
                    FROM follows
                    WHERE following_id = users.id
                ) AS followers_count,
                (
                    SELECT COUNT(*)
                    FROM follows
                    WHERE follower_id = users.id
                ) AS following_count
            FROM users
            WHERE lower(users.username) LIKE lower(?)
            ORDER BY users.username COLLATE NOCASE
            LIMIT 50
        `).all('%' + query + '%');
    }

    const me = currentUser(req);

    const resultsHtml = results.length
        ? results.map(user => {
            const isMe = me && Number(me.id) === Number(user.id);

            let followButton = '';

            if (me && !isMe) {
                const following = db.prepare(`
                    SELECT id
                    FROM follows
                    WHERE follower_id = ?
                      AND following_id = ?
                `).get(me.id, user.id);

                followButton = `
                    <form method="post"
                          action="/users/${Number(user.id)}/follow">
                        ${tokenField(req)}
                        <button type="submit">
                            ${following ? 'Unfollow' : 'Follow'}
                        </button>
                    </form>
                `;
            }

            return `
                <article class="card">
                    <h3>
                        <a href="/users/${Number(user.id)}">
                            @${escapeHtml(user.username)}
                        </a>
                    </h3>

                    <p>
                        Followers: ${Number(user.followers_count)}
                        · Following: ${Number(user.following_count)}
                    </p>

                    ${followButton}
                </article>
            `;
        }).join('')
        : '<p>Nta bantu babonetse. Gerageza irindi zina.</p>';

    render(res, 'Search People', `
        <section class="card">
            <h2>Search People</h2>

            <form method="get" action="/search">
                <label>Shakisha username</label>

                <input
                    type="search"
                    name="q"
                    maxlength="100"
                    value="${escapeHtml(query)}"
                    placeholder="Andika izina..."
                >

                <button type="submit">Search</button>
            </form>
        </section>

        <section>
            ${resultsHtml}
        </section>
    `, me);
});


/* =========================================
   FOLLOW / UNFOLLOW
========================================= */

app.post(
    '/users/:id/follow',
    requireLogin,
    checkToken,
    (req, res, next) => {
        try {
            const targetId = Number(req.params.id);
            const myId = Number(req.session.userId);

            if (
                !Number.isSafeInteger(targetId) ||
                targetId <= 0 ||
                targetId === myId
            ) {
                return message(
                    res,
                    'Follow',
                    'Ntushobora gukurikira iyi konti.',
                    currentUser(req)
                );
            }

            const target = db.prepare(`
                SELECT id
                FROM users
                WHERE id = ?
            `).get(targetId);

            if (!target) {
                return message(
                    res,
                    'Konti ntiboneka',
                    'Uyu muntu ntakiboneka.',
                    currentUser(req)
                );
            }

            const existing = db.prepare(`
                SELECT id
                FROM follows
                WHERE follower_id = ?
                  AND following_id = ?
            `).get(myId, targetId);

            if (existing) {
                db.prepare(`
                    DELETE FROM follows
                    WHERE follower_id = ?
                      AND following_id = ?
                `).run(myId, targetId);
            } else {
                db.prepare(`
                    INSERT INTO follows (
                        follower_id,
                        following_id
                    )
                    VALUES (?, ?)
                `).run(myId, targetId);
            }

            const back = String(req.get('referer') || '');

            if (
                back.startsWith('https://' + req.get('host')) ||
                back.startsWith('http://' + req.get('host'))
            ) {
                return res.redirect(back);
            }

            return res.redirect('/search');

        } catch (err) {
            return next(err);
        }
    }
);


/* =========================================
   USER PROFILE
========================================= */

app.get('/users/:id', (req, res, next) => {
    try {
        const userId = Number(req.params.id);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(404).send('User not found.');
        }

        const user = db.prepare(`
            SELECT id, username
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).send('User not found.');
        }

        const followers = db.prepare(`
            SELECT COUNT(*) AS total
            FROM follows
            WHERE following_id = ?
        `).get(userId).total;

        const following = db.prepare(`
            SELECT COUNT(*) AS total
            FROM follows
            WHERE follower_id = ?
        `).get(userId).total;

        const me = currentUser(req);

        let followButton = '';

        if (me && Number(me.id) !== Number(user.id)) {
            const isFollowing = db.prepare(`
                SELECT id
                FROM follows
                WHERE follower_id = ?
                  AND following_id = ?
            `).get(me.id, userId);

            followButton = `
                <form method="post"
                      action="/users/${Number(user.id)}/follow">
                    ${tokenField(req)}
                    <button type="submit">
                        ${isFollowing ? 'Unfollow' : 'Follow'}
                    </button>
                </form>
            `;
        }

        const posts = db.prepare(`
            SELECT
                posts.*,
                users.username,
                (
                    SELECT COUNT(*)
                    FROM likes
                    WHERE likes.post_id = posts.id
                ) AS likes_count,
                (
                    SELECT COUNT(*)
                    FROM comments
                    WHERE comments.post_id = posts.id
                ) AS comments_count
            FROM posts
            JOIN users ON users.id = posts.user_id
            WHERE posts.user_id = ?
            ORDER BY posts.id DESC
            LIMIT 50
        `).all(userId);

        const postsHtml = posts.map(post => {
            let mediaHtml = '';

            if (post.media_url) {
                const safeUrl = escapeHtml(post.media_url);

                if (post.type === 'photo') {
                    mediaHtml = `
                        <img
                            src="${safeUrl}"
                            alt="Post image"
                            style="max-width:100%;height:auto"
                        >
                    `;
                } else if (post.type === 'video') {
                    mediaHtml = `
                        <video
                            controls
                            playsinline
                            style="max-width:100%;height:auto"
                        >
                            <source src="${safeUrl}">
                        </video>
                    `;
                } else if (post.type === 'audio') {
                    mediaHtml = `
                        <audio controls style="width:100%">
                            <source src="${safeUrl}">
                        </audio>
                    `;
                } else {
                    mediaHtml = `
                        <p>
                            <a href="${safeUrl}" target="_blank"
                               rel="noopener noreferrer">
                                Open media
                            </a>
                        </p>
                    `;
                }
            }

            const likeForm = me ? `
                <form method="post"
                      action="/posts/${Number(post.id)}/like">
                    ${tokenField(req)}
                    <button type="submit">Like / Unlike</button>
                </form>
            ` : '';

            const commentForm = me ? `
                <form method="post"
                      action="/posts/${Number(post.id)}/comment">
                    ${tokenField(req)}
                    <textarea name="content"
                              maxlength="2000"
                              required
                              placeholder="Andika comment..."></textarea>
                    <button type="submit">Comment</button>
                </form>
            ` : '';

            return `
                <article class="card">
                    <h3>${escapeHtml(post.type)}</h3>
                    <p>${escapeHtml(post.content || '')}</p>
                    ${mediaHtml}
                    <p>
                        Likes: ${Number(post.likes_count)}
                        · Comments: ${Number(post.comments_count)}
                    </p>
                    ${likeForm}
                    ${commentForm}
                </article>
            `;
        }).join('');

        render(res, '@' + user.username, `
            <section class="card">
                <h2>@${escapeHtml(user.username)}</h2>
                <p>Followers: ${Number(followers)}</p>
                <p>Following: ${Number(following)}</p>
                ${followButton}
            </section>

            <h2>Posts</h2>

            ${postsHtml || '<p>Nta post uyu muntu arashyiraho.</p>'}
        `, me);

    } catch (err) {
        next(err);
    }
});


/* =========================================
   HEALTH CHECK
========================================= */

app.get('/health', (req, res) => {
    try {
        db.prepare('SELECT 1 AS ok').get();

        res.status(200).json({
            status: 'ok',
            app: '1KEON',
            database: 'connected'
        });
    } catch (err) {
        console.error('Health check failed:', err);

        res.status(500).json({
            status: 'error',
            app: '1KEON',
            database: 'unavailable'
        });
    }
});


/* =========================================
   404 — PAGE NOT FOUND
========================================= */

app.use((req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport"
                  content="width=device-width, initial-scale=1">
            <title>Page Not Found — 1KEON</title>
        </head>
        <body style="font-family:Arial,sans-serif;padding:24px">
            <h1>404 — Page Not Found</h1>
            <p>Iyi page ntiyabonetse kuri 1KEON.</p>
            <a href="/">Subira kuri Home</a>
        </body>
        </html>
    `);
});


/* =========================================
   ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
    console.error('Application error:', err);

    if (res.headersSent) {
        return next(err);
    }

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).send(`
                <h2>File nini cyane</h2>
                <p>Hitamo ifoto cyangwa video itarenza 50 MB.</p>
                <a href="/create">Subira kuri Create Post</a>
            `);
        }

        return res.status(400).send(`
            <h2>Upload yanze</h2>
            <p>Reba file wahisemo wongere ugerageze.</p>
            <a href="/create">Subira kuri Create Post</a>
        `);
    }

    if (
        err.message ===
        'Wemerewe kohereza amafoto na video gusa.'
    ) {
        return res.status(400).send(`
            <h2>File ntiyemewe</h2>
            <p>Ushobora kohereza amafoto na video gusa.</p>
            <a href="/create">Subira kuri Create Post</a>
        `);
    }

    res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport"
                  content="width=device-width, initial-scale=1">
            <title>Error — 1KEON</title>
        </head>
        <body style="font-family:Arial,sans-serif;padding:24px">
            <h1>Habaye ikibazo</h1>
            <p>Server yagize ikibazo. Ongera ugerageze nyuma.</p>
            <a href="/">Subira kuri Home</a>
        </body>
        </html>
    `);
});


/* =========================================
   START SERVER
========================================= */

app.listen(PORT, '0.0.0.0', () => {
    console.log(`1KEON is running on port ${PORT}`);
});
