document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelector(".nav-links");
  navToggle?.addEventListener("click", () => {
    navLinks?.classList.toggle("open");
  });

  // Theme toggle
  const themeToggle = document.querySelector("#theme-toggle");
  const storedTheme = localStorage.getItem("theme");
  if (storedTheme === "dark") {
    document.body.classList.add("dark");
  }
  const updateThemeLabel = () => {
    if (!themeToggle) return;
    const isDark = document.body.classList.contains("dark");
    themeToggle.textContent = isDark ? "Chiaro" : "Scuro";
    themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  };
  updateThemeLabel();
  themeToggle?.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const mode = document.body.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("theme", mode);
    updateThemeLabel();
  });

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener("click", event => {
      const targetId = link.getAttribute("href");
      if (!targetId || targetId === "#") return;
      event.preventDefault();
      document.querySelector(targetId)?.scrollIntoView({ behavior: "smooth" });
      navLinks?.classList.remove("open");
    });
  });

  // Breadcrumb dinamico
  const breadcrumbCurrent = document.getElementById("breadcrumb-current");
  const breadcrumbLive = document.getElementById("breadcrumb-live");
  const crumbSections = Array.from(document.querySelectorAll("main section, header.hero"));
  const labelForSection = section => {
    if (!section) return "Sezione";
    if (section.id === "home") return "Home";
    const heading = section.querySelector("h2") || section.querySelector("h1");
    return heading?.textContent?.trim() || section.id || "Sezione";
  };
  const setBreadcrumb = section => {
    const label = labelForSection(section);
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = label;
    if (breadcrumbLive) breadcrumbLive.textContent = `Sezione attiva: ${label}`;
  };
  const crumbObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) setBreadcrumb(entry.target);
    });
  }, { threshold: 0.45 });
  crumbSections.forEach(sec => crumbObserver.observe(sec));
  setBreadcrumb(document.getElementById("home"));

  // Motore di ricerca interno
  const siteSearch = document.querySelector("#site-search");
  const searchResults = document.querySelector("#search-results");
  const searchIndex = Array.from(document.querySelectorAll("main section")).map(section => {
    const title = section.querySelector("h2")?.textContent || section.id;
    const summary = section.querySelector("p")?.textContent || "";
    return { id: section.id, title, summary };
  });
  const renderResults = results => {
    if (!searchResults) return;
    if (!results.length) {
      searchResults.innerHTML = '<div class="empty">Nessun contenuto trovato.</div>';
      return;
    }
    searchResults.innerHTML = results.map(item => `
      <div class="result">
        <a href="#${item.id}"><span class="keyword">#${item.id}</span> ${item.title}</a>
        <div class="summary">${item.summary.slice(0, 120)}...</div>
      </div>
    `).join("");
  };
  const filterResults = term => {
    const value = term.trim().toLowerCase();
    if (!value) return searchIndex.slice(0, 6);
    return searchIndex
      .filter(entry => (entry.title + entry.summary + entry.id).toLowerCase().includes(value))
      .slice(0, 8);
  };
  renderResults(filterResults(""));
  siteSearch?.addEventListener("input", event => {
    const term = event.target.value || "";
    renderResults(filterResults(term));
  });

  const backToTop = document.querySelector(".back-to-top");
  window.addEventListener("scroll", () => {
    if (!backToTop) return;
    backToTop.classList.toggle("show", window.scrollY > 500);
  });
  backToTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Animated counters
  const counters = document.querySelectorAll("[data-counter]");
  const animateCounter = el => {
    const target = Number(el.dataset.target || 0);
    const duration = 1200;
    const start = performance.now();

    const tick = now => {
      const progress = Math.min((now - start) / duration, 1);
      const value = Math.floor(progress * target);
      el.textContent = value.toString();
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const counterObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.6 });
  counters.forEach(counter => counterObserver.observe(counter));

  // Reveal on scroll
  document.querySelectorAll(".section, .tile, .card, .shot").forEach(el => {
    el.classList.add("fade-in");
  });
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });
  document.querySelectorAll(".fade-in").forEach(el => revealObserver.observe(el));

  // FAQ accordion
  document.querySelectorAll(".accordion-item").forEach(item => {
    item.addEventListener("click", () => {
      item.classList.toggle("active");
    });
  });

  // Testimonials slider
  const slides = Array.from(document.querySelectorAll(".slide"));
  const dots = Array.from(document.querySelectorAll(".slider-dots .dot"));
  let current = 0;
  const goTo = index => {
    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
    current = index;
  };
  dots.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));
  if (slides.length) {
    setInterval(() => goTo((current + 1) % slides.length), 6000);
  }

  // Portfolio filter
  const filterButtons = document.querySelectorAll(".filter");
  const shots = document.querySelectorAll(".shot");
  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.filter || "all";
      filterButtons.forEach(b => b.classList.toggle("active", b === btn));
      shots.forEach(card => {
        const cat = card.dataset.category || "";
        const show = target === "all" || cat === target;
        card.style.display = show ? "block" : "none";
      });
    });
  });

  // Blog search
  const blogSearch = document.querySelector("#blog-search");
  const posts = document.querySelectorAll("#blog-list .post");
  blogSearch?.addEventListener("input", event => {
    const term = event.target.value.toLowerCase();
    posts.forEach(post => {
      const text = post.textContent.toLowerCase();
      post.style.display = text.includes(term) ? "block" : "none";
    });
  });

  // Contact form with basic validation
  const contactForm = document.querySelector("#contact-form");
  contactForm?.addEventListener("submit", event => {
    event.preventDefault();
    const errors = [];
    const showError = (name, message) => {
      const field = contactForm.querySelector(`[name="${name}"]`);
      const errorEl = contactForm.querySelector(`[data-error-for="${name}"]`);
      if (field) field.classList.add("invalid");
      if (errorEl) errorEl.textContent = message || "";
    };
    const clearErrors = () => {
      contactForm.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
      contactForm.querySelectorAll(".error").forEach(el => { el.textContent = ""; });
    };
    clearErrors();
    const nome = contactForm.elements.nome.value.trim();
    const email = contactForm.elements.email.value.trim();
    const tipo = contactForm.elements.tipo.value.trim();
    const budget = contactForm.elements.budget.value.trim();
    if (!nome) errors.push(["nome", "Indica il tuo nome."]);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(["email", "Email non valida."]);
    }
    if (!tipo) errors.push(["tipo", "Seleziona il tipo di progetto."]);
    if (budget && !/^[0-9\\.\\s€]+$/.test(budget)) {
      errors.push(["budget", "Inserisci solo numeri e simboli euro."]);
    }
    if (errors.length) {
      errors.forEach(([field, msg]) => showError(field, msg));
      return;
    }
    const button = contactForm.querySelector("button");
    if (button) {
      button.textContent = "Inviato!";
      button.disabled = true;
    }
    contactForm.insertAdjacentHTML("beforeend", '<p class="fine-print success">Grazie, ti rispondiamo entro 24h.</p>');
  });

  // Feedback form
  const feedbackForm = document.querySelector("#feedback-form");
  feedbackForm?.addEventListener("submit", event => {
    event.preventDefault();
    const rating = feedbackForm.querySelector('input[name="soddisfazione"]:checked');
    const errorEl = feedbackForm.querySelector('[data-error-for="soddisfazione"]');
    if (errorEl) errorEl.textContent = "";
    if (!rating) {
      if (errorEl) errorEl.textContent = "Seleziona un punteggio da 1 a 5.";
      return;
    }
    const btn = feedbackForm.querySelector("button");
    if (btn) {
      btn.textContent = "Grazie!";
      btn.disabled = true;
    }
    feedbackForm.insertAdjacentHTML("beforeend", '<p class="fine-print success">Feedback registrato, useremo i dati per migliorare il sito.</p>');
  });

  // Newsletter form
  const newsletter = document.querySelector(".newsletter");
  newsletter?.addEventListener("submit", event => {
    event.preventDefault();
    const btn = newsletter.querySelector("button");
    if (btn) {
      btn.textContent = "Iscritto!";
      btn.disabled = true;
    }
  });

  // Cookie banner & preferenze
  const cookieBanner = document.querySelector(".cookie-banner");
  const cookieAccept = document.getElementById("cookie-accept");
  const cookieDeny = document.getElementById("cookie-deny");
  const cookieForm = document.getElementById("cookie-form");
  const analyticsToggle = document.getElementById("analytics-consent");
  const marketingToggle = document.getElementById("marketing-consent");
  const consentKey = "stella-cookie-consent-v1";
  const toggleBanner = show => {
    if (cookieBanner) cookieBanner.classList.toggle("hidden", !show);
  };
  const syncToggles = consent => {
    if (!consent) return;
    if (analyticsToggle) analyticsToggle.checked = Boolean(consent.analytics);
    if (marketingToggle) marketingToggle.checked = Boolean(consent.marketing);
  };
  const loadConsent = () => {
    try { return JSON.parse(localStorage.getItem(consentKey) || "null"); }
    catch { return null; }
  };
  const saveConsent = consent => {
    localStorage.setItem(consentKey, JSON.stringify(consent));
    toggleBanner(false);
    syncToggles(consent);
  };
  const existingConsent = loadConsent();
  toggleBanner(!existingConsent);
  syncToggles(existingConsent);

  cookieAccept?.addEventListener("click", () => {
    saveConsent({ analytics: true, marketing: true, date: new Date().toISOString() });
  });
  cookieDeny?.addEventListener("click", () => {
    saveConsent({ analytics: false, marketing: false, date: new Date().toISOString() });
  });
  cookieForm?.addEventListener("submit", event => {
    event.preventDefault();
    const consent = {
      analytics: analyticsToggle?.checked || false,
      marketing: marketingToggle?.checked || false,
      date: new Date().toISOString(),
    };
    saveConsent(consent);
    document.getElementById("cookie-modal")?.classList.remove("open");
  });

  // Modal case study
  const openButtons = document.querySelectorAll("[data-open-modal]");
  const closeButtons = document.querySelectorAll("[data-close-modal]");
  openButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.openModal;
      const modal = document.getElementById(id);
      modal?.classList.add("open");
    });
  });
  closeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".modal")?.classList.remove("open");
    });
  });
  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target === modal) modal.classList.remove("open");
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal.open").forEach(modal => modal.classList.remove("open"));
    }
  });

  // Flappy Stella mini-gioco
  const gameCanvas = document.getElementById("flappy-canvas");
  const startBtn = document.getElementById("flappy-start");
  const resetBtn = document.getElementById("flappy-reset");
  const statusLabel = document.getElementById("flappy-status");
  const scoreLabel = document.getElementById("flappy-score");
  const bestLabel = document.getElementById("flappy-best");

  if (gameCanvas && gameCanvas.getContext) {
    const ctx = gameCanvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = 360;
    const height = 540;
    const bird = { x: 90, y: height / 2, vy: 0, size: 20 };
    const pipes = [];
    const PIPE_GAP = 150;
    const PIPE_WIDTH = 64;
    const PIPE_SPEED = 2.6;
    const GRAVITY = 0.35;
    const JUMP = -6.5;
    const SPAWN_MS = 1500;

    let running = false;
    let gameOver = false;
    let lastTime = 0;
    let spawnTimer = 0;
    let score = 0;
    const bestKey = "flappy-best";
    let bestScore = Number(localStorage.getItem(bestKey)) || 0;

    const setStatus = text => { if (statusLabel) statusLabel.textContent = text; };
    const updateLabels = () => {
      if (scoreLabel) scoreLabel.textContent = score.toString();
      if (bestLabel) bestLabel.textContent = bestScore.toString();
    };

    const setCanvasSize = () => {
      gameCanvas.width = width * dpr;
      gameCanvas.height = height * dpr;
      gameCanvas.style.width = "100%";
      gameCanvas.style.maxWidth = "460px";
      gameCanvas.style.height = "auto";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);
    updateLabels();

    const spawnPipe = () => {
      const margin = 90;
      const gapY = margin + Math.random() * (height - margin * 2);
      pipes.push({ x: width + PIPE_WIDTH, gapY, passed: false });
    };

    const reset = autostart => {
      pipes.length = 0;
      spawnTimer = 0;
      bird.y = height / 2;
      bird.vy = 0;
      score = 0;
      gameOver = false;
      running = Boolean(autostart);
      lastTime = performance.now();
      updateLabels();
      setStatus("Tocca o premi spazio per saltare.");
      draw();
      if (running) requestAnimationFrame(loop);
    };

    const endGame = () => {
      running = false;
      gameOver = true;
      setStatus("Game over: spazio o start per ripartire.");
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem(bestKey, bestScore.toString());
      }
      updateLabels();
      draw(true);
    };

    const drawBackground = () => {
      const style = getComputedStyle(document.documentElement);
      const bg = (style.getPropertyValue("--bg") || "#e2e8f0").trim();
      const accent = (style.getPropertyValue("--accent") || "#0ea5e9").trim();
      const accent2 = (style.getPropertyValue("--accent-2") || "#f59e0b").trim();
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#f8fafc");
      gradient.addColorStop(1, bg);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = accent + "33";
      ctx.fillRect(0, height - 22, width, 22);
      ctx.fillStyle = accent2 + "44";
      for (let i = 0; i < 6; i++) {
        const y = 40 + i * 80;
        ctx.fillRect(0, y, width, 1);
      }
    };

    const drawPipes = () => {
      const accent = (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#0ea5e9").trim();
      ctx.fillStyle = accent;
      pipes.forEach(pipe => {
        const topH = pipe.gapY - PIPE_GAP / 2;
        const bottomY = pipe.gapY + PIPE_GAP / 2;
        const bottomH = height - bottomY;
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, topH);
        ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, bottomH);
      });
    };

    const drawBird = () => {
      ctx.save();
      ctx.translate(bird.x, bird.y);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(0, 0, bird.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(6, -6, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawScore = () => {
      ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
      ctx.font = "700 18px Manrope, sans-serif";
      ctx.fillText(`Score: ${score}`, 14, 28);
      ctx.fillText(`Best: ${bestScore}`, 14, 52);
    };

    const draw = showOutline => {
      drawBackground();
      drawPipes();
      drawBird();
      drawScore();
      if (showOutline && gameOver) {
        ctx.fillStyle = "rgba(15,23,42,0.72)";
        ctx.fillRect(0, height / 2 - 40, width, 80);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "700 20px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Riprova: spazio o Start", width / 2, height / 2 + 6);
        ctx.textAlign = "start";
      }
    };

    const loop = now => {
      if (!running) return;
      const delta = now - lastTime;
      lastTime = now;
      const step = delta / 16.67;
      let ended = false;

      spawnTimer += delta;
      if (spawnTimer >= SPAWN_MS) {
        spawnTimer = 0;
        spawnPipe();
      }

      bird.vy += GRAVITY * step;
      bird.y += bird.vy * step;

      pipes.forEach(pipe => { pipe.x -= PIPE_SPEED * step; });
      while (pipes.length && pipes[0].x + PIPE_WIDTH < -10) pipes.shift();

      pipes.forEach(pipe => {
        if (!pipe.passed && pipe.x + PIPE_WIDTH < bird.x) {
          pipe.passed = true;
          score += 1;
          updateLabels();
          setStatus(`Vai! Punteggio ${score}`);
        }
        if (!gameOver) {
          const inX = bird.x + bird.size > pipe.x && bird.x - bird.size < pipe.x + PIPE_WIDTH;
          const inGap = bird.y - bird.size > pipe.gapY - PIPE_GAP / 2 && bird.y + bird.size < pipe.gapY + PIPE_GAP / 2;
          if (inX && !inGap) {
            ended = true;
            endGame();
          }
        }
      });

      if (!ended && (bird.y - bird.size <= 0 || bird.y + bird.size >= height)) {
        ended = true;
        endGame();
      }

      if (ended) return;

      draw();
      if (running) requestAnimationFrame(loop);
    };

    const flap = () => {
      if (gameOver) {
        reset(true);
        return;
      }
      if (!running) {
        running = true;
        gameOver = false;
        lastTime = performance.now();
        requestAnimationFrame(loop);
        setStatus("In gioco: evita i tubi.");
      }
      bird.vy = JUMP;
    };

    startBtn?.addEventListener("click", flap);
    resetBtn?.addEventListener("click", () => reset(false));
    gameCanvas.addEventListener("pointerdown", flap);
    window.addEventListener("keydown", event => {
      if (event.code === "Space") {
        event.preventDefault();
        flap();
      }
    });

    reset(false);
  }
});
