
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const sbReady = SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_") &&
  !SUPABASE_ANON_KEY.includes("YOUR_");

const db = sbReady
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = (id) => document.getElementById(id);

const authDialog = $("auth-dialog");
const paymentDialog = $("payment-dialog");
const movieDialog = $("movie-dialog");

let currentUser = null;
let isAdmin = false;
let currentPlan = null;
let movies = [];
let hasAccess = false;

const plans = {
  two_days: { name: "2 Days", amount: 1000, duration: 2 },
  three_days: { name: "3 Days", amount: 1500, duration: 3 },
  one_week: { name: "1 Week", amount: 3000, duration: 7 }
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

function notice(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}

function hideNotice(id) {
  $(id).classList.add("hidden");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function normalizeUgPhone(value) {
  let p = value.replace(/[\s()+-]/g, "");

  if (p.startsWith("0")) p = "256" + p.slice(1);
  if (p.startsWith("7")) p = "256" + p;

  if (!/^256(7[0-9]{8})$/.test(p)) {
    throw new Error("Enter a valid Ugandan mobile number, e.g. 0771234567.");
  }

  return p;
}

async function refreshSession() {
  if (!db) {
    toast("Add your Supabase URL and anon key in app.js first.");
    return;
  }

  const { data: { session } } = await db.auth.getSession();
  currentUser = session?.user || null;

  $("user-label").textContent = currentUser
    ? (currentUser.email || "Signed in")
    : "Not signed in";

  $("auth-open").classList.toggle("hidden", !!currentUser);
  $("logout-btn").classList.toggle("hidden", !currentUser);

  if (currentUser) {
    const { data: profile } = await db
      .from("profiles")
      .select("is_admin")
      .eq("id", currentUser.id)
      .maybeSingle();

    isAdmin = !!profile?.is_admin;

    await refreshAccess();
    await loadMovies();

    $("admin-section").classList.toggle("hidden", !isAdmin);
  } else {
    isAdmin = false;
    hasAccess = false;
    movies = [];

    $("admin-section").classList.add("hidden");
    $("access-status").textContent = "Sign in to check access";
    $("access-status").classList.remove("active");

    renderMovies();
  }
}

async function refreshAccess() {
  const { data, error } = await db
    .from("subscriptions")
    .select("expires_at,status")
    .eq("user_id", currentUser.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  hasAccess = !error && !!data;

  $("access-status").textContent = hasAccess
    ? `Access active until ${new Date(data.expires_at).toLocaleString()}`
    : "No active package";

  $("access-status").classList.toggle("active", hasAccess);
}

async function loadMovies() {
  const { data, error } = await db
    .from("movies")
    .select("id,title,genre,description,poster_url,created_at")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    $("movie-grid").innerHTML =
      '<div class="empty-state">Could not load movies. Check your Supabase setup.</div>';
    return;
  }

  movies = data || [];
  renderMovies();
}

function renderMovies() {
  const query = $("movie-search").value.toLowerCase().trim();

  const list = movies.filter(m =>
    (m.title + " " + (m.genre || "")).toLowerCase().includes(query)
  );

  if (!currentUser) {
    $("movie-grid").innerHTML =
      '<div class="empty-state">Please sign in to browse movies.</div>';
    return;
  }

  if (!list.length) {
    $("movie-grid").innerHTML =
      '<div class="empty-state">No movies found yet. Check back soon.</div>';
    return;
  }

  $("movie-grid").innerHTML = list.map(m => `
    <article class="movie-card" data-id="${m.id}">
      <div class="movie-poster">
        ${m.poster_url
          ? `<img src="${escapeHtml(m.poster_url)}"
                  alt="${escapeHtml(m.title)} poster"
                  loading="lazy"
                  onerror="this.remove()">`
          : '<div class="movie-placeholder">CV</div>'}
      </div>
      <h3>${escapeHtml(m.title)}</h3>
      <p>${escapeHtml(m.genre || "Movie")}</p>
    </article>
  `).join("");

  document.querySelectorAll(".movie-card").forEach(card => {
    card.addEventListener("click", () => openMovie(card.dataset.id));
  });
}

async function openMovie(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie) return;

  $("movie-detail").innerHTML = `
    <div class="movie-detail">
      ${movie.poster_url
        ? `<img src="${escapeHtml(movie.poster_url)}" alt="">`
        : '<div class="movie-poster movie-placeholder">CV</div>'}
      <div>
        <span class="eyebrow">${escapeHtml(movie.genre || "MOVIE")}</span>
        <h2>${escapeHtml(movie.title)}</h2>
        <p>${escapeHtml(movie.description || "No description available.")}</p>
        <div id="movie-action-area">
          ${hasAccess
            ? '<button id="play-movie" class="btn btn-primary">Watch / Download</button>'
            : '<p>Your account needs an active package to watch or download this movie.</p><a class="btn btn-primary" href="#plans" id="movie-plans">View packages</a>'}
        </div>
      </div>
    </div>
  `;

  movieDialog.showModal();

  $("play-movie")?.addEventListener("click", () => getMovieFile(movie.id));
  $("movie-plans")?.addEventListener("click", () => movieDialog.close());
}

async function getMovieFile(id) {
  const button = $("play-movie");

  if (button) {
    button.disabled = true;
    button.textContent = "Preparing secure link...";
  }

  try {
    const { data, error } = await db.functions.invoke("get-movie-url", {
      body: { movie_id: id }
    });

    if (error) throw error;
    if (!data?.url) throw new Error(data?.error || "Could not create movie link.");

    const movie = movies.find(m => m.id === id);

    $("movie-action-area").innerHTML = `
      <video controls playsinline preload="metadata"
             src="${escapeHtml(data.url)}"></video>

      <a class="btn btn-outline"
         style="margin-top:12px"
         href="${escapeHtml(data.url)}"
         download="${escapeHtml((movie?.title || "movie").replace(/[^a-z0-9-_]/gi, "_"))}">
         Download movie
      </a>

      <p class="fine-print">
        This temporary link expires automatically.
      </p>
    `;
  } catch (e) {
    toast(e.message || "Unable to access movie.");

    if (button) {
      button.disabled = false;
      button.textContent = "Try again";
    }
  }
}

function openAuth(mode = "login") {
  $("auth-title").textContent =
    mode === "login" ? "Sign in" : "Create account";

  $("auth-submit").textContent =
    mode === "login" ? "Sign in" : "Create account";

  $("name-field").classList.toggle("hidden", mode === "login");

  $("switch-copy").textContent =
    mode === "login" ? "New here?" : "Already registered?";

  $("switch-auth").textContent =
    mode === "login" ? "Create an account" : "Sign in";

  $("auth-form").dataset.mode = mode;

  hideNotice("auth-message");
  authDialog.showModal();
}

$("auth-open").addEventListener("click", () => openAuth());
$("auth-close").addEventListener("click", () => authDialog.close());

$("switch-auth").addEventListener("click", () => {
  openAuth(
    $("auth-form").dataset.mode === "login" ? "register" : "login"
  );
});

$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!db) return toast("Configure Supabase first.");

  const form = new FormData(e.currentTarget);
  const email = form.get("email");
  const password = form.get("password");
  const mode = e.currentTarget.dataset.mode;

  try {
    if (mode === "register") {
      const { error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: form.get("full_name") || "" }
        }
      });

      if (error) throw error;

      notice(
        "auth-message",
        "Account created. If email confirmation is enabled, verify your email before signing in."
      );
    } else {
      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      authDialog.close();
      e.currentTarget.reset();

      await refreshSession();
      toast("Signed in successfully.");
    }
  } catch (err) {
    notice("auth-message", err.message || "Authentication failed.", true);
  }
});

$("logout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
  await refreshSession();
  toast("You have signed out.");
});

document.querySelectorAll(".plan-select").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!currentUser) {
      openAuth();
      toast("Sign in before choosing a package.");
      return;
    }

    currentPlan = plans[btn.dataset.plan];

    $("selected-plan").textContent =
      `${currentPlan.name} — UGX ${currentPlan.amount.toLocaleString()}`;

    hideNotice("payment-message");
    paymentDialog.showModal();
  });
});

$("payment-close").addEventListener("click", () => paymentDialog.close());

$("payment-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentUser) return openAuth();

  const form = new FormData(e.currentTarget);
  const button = e.currentTarget.querySelector("button");

  try {
    const phone = normalizeUgPhone(String(form.get("phone")));

    button.disabled = true;
    button.textContent = "Sending request...";

    const planId = Object.keys(plans).find(
      key => plans[key] === currentPlan
    );

    const { data, error } = await db.functions.invoke("create-payment", {
      body: {
        plan_id: planId,
        provider_code: form.get("provider"),
        phone
      }
    });

    if (error) throw error;

    notice(
      "payment-message",
      data?.message ||
      "Payment request sent. Approve the prompt on your phone. Your access activates after GovBill confirms payment."
    );
  } catch (err) {
    notice("payment-message", err.message || "Payment request failed.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Request payment";
  }
});

$("movie-search").addEventListener("input", renderMovies);
$("movie-close").addEventListener("click", () => movieDialog.close());

$("movie-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!isAdmin) return;

  const form = e.currentTarget;
  const fd = new FormData(form);
  const file = fd.get("video");

  try {
    if (!file || !file.size) {
      throw new Error("Choose a video file.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${crypto.randomUUID()}/${safeName}`;

    notice("admin-message", "Uploading video...");

    const upload = await db.storage
      .from("movie-files")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (upload.error) throw upload.error;

    const insert = await db.from("movies").insert({
      title: fd.get("title"),
      genre: fd.get("genre"),
      description: fd.get("description"),
      poster_url: fd.get("poster_url") || null,
      storage_path: path,
      is_published: true
    }).select().single();

    if (insert.error) {
      await db.storage.from("movie-files").remove([path]);
      throw insert.error;
    }

    form.reset();
    notice("admin-message", "Movie uploaded and published.");
    await loadMovies();

  } catch (err) {
    notice("admin-message", err.message || "Upload failed.", true);
  }
});

$("year").textContent = new Date().getFullYear();

if (db) {
  db.auth.onAuthStateChange(() => {
    setTimeout(refreshSession, 0);
  });
}

refreshSession();
