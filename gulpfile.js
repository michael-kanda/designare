import gulp from 'gulp';
import concat from 'gulp-concat';
import cleanCSS from 'gulp-clean-css';

const { src, dest, parallel } = gulp;

// 1. CORE: Wird auf ALLEN Seiten geladen
// WICHTIG: light-mode.css MUSS am Ende stehen!
const coreFiles = [
    'css/style.css',              // Reset & Vars
    'css/header-footer.css',      // Globales Layout
    'css/evita-greeting.css',
    'css/side-menu.css',          // Navigation
    'css/menu-interactive.css',   // Interaktive Menus
    'css/ai-styles.css',
    'css/evita-styles.css',
    'css/evita-toolbar.css',
    'css/booking.css',      
    'css/legal-style.css',    
    'css/light-mode.css'         // MUSS ZULETZT sein fuer Overrides
];

// 2. HOME: Nur fuer index.html
const homeFiles = [
    'css/flip-card.css',          // Nur Startseite
    'css/terminal-fix.css',       // Nur Startseite
    'css/homepage-scroll-fix.css' // Nur Startseite
];

// 3. ARTICLE: Fuer Blogposts (OHNE Silas)
const articleFiles = [
    'css/blog-style.css',         // Basis Blog-Layout
    'css/blog-components.css',    // Blog-Komponenten
    'css/feedback-style.css',     // Feedback Formulare
    'css/lightbox.css', 
    'css/evita-animations.css',
    'css/geo-xray.css',
    'css/ki-morph.css',
    'css/ai-hero-eyes.css',
    'css/geo-seo-animations.css',
    'css/schema-org-animations.css',
    'css/seo-wunderkiste-anim.css',
    'css/wp-ki-core-anim.css',
    'css/ai-visibility.css'
];

// --- TASKS ---

function buildCore() {
    return src(coreFiles, { allowEmpty: true }) 
        .pipe(concat('core.min.css'))
        .pipe(cleanCSS({ compatibility: 'ie11', level: 2 }))
        .pipe(dest('public/css'));
}

function buildHome() {
    return src(homeFiles, { allowEmpty: true })
        .pipe(concat('home.min.css'))
        .pipe(cleanCSS({ compatibility: 'ie11', level: 2 }))
        .pipe(dest('public/css'));
}

function buildArticle() {
    return src(articleFiles, { allowEmpty: true })
        .pipe(concat('article.min.css'))
        .pipe(cleanCSS({ compatibility: 'ie11', level: 2 }))
        .pipe(dest('public/css'));
}

// Eigener Task nur fuer Silas
function buildSilas() {
    return src('css/silas.css', { allowEmpty: true })
        .pipe(cleanCSS({ compatibility: 'ie11', level: 2 }))
        .pipe(dest('public/css'));
}

// Alle Tasks parallel ausfuehren
export default parallel(buildCore, buildHome, buildArticle, buildSilas);
