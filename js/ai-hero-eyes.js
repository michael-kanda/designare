// js/ai-hero-eyes.js — Dual AI Eye Hero Animation
// Lid open, eye tracking, blink, eye roll, typewriter

(function() {
    'use strict';

    // ==============================================
    // ELEMENTS
    // ==============================================
    const lidG = document.querySelector('#lidClipGemini .lid-ellipse');
    const lidC = document.querySelector('#lidClipChatgpt .lid-ellipse');
    const irisG = document.getElementById('irisGemini');
    const irisC = document.getElementById('irisChatgpt');
    const eyeG = document.getElementById('eyeGemini');
    const eyeC = document.getElementById('eyeChatgpt');

    if (!lidG || !lidC) return; // Hero not on page

    const RY_OPEN = 42;
    let isRolling = false;

    // ==============================================
    // LID OPEN (animate SVG ry attribute)
    // ==============================================
    function animateRy(ellipse, from, to, duration, delay) {
        setTimeout(() => {
            const start = performance.now();
            function tick(now) {
                const t = Math.min((now - start) / duration, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                ellipse.setAttribute('ry', from + (to - from) * ease);
                if (t < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        }, delay);
    }

    animateRy(lidG, 0, RY_OPEN, 1200, 800);
    animateRy(lidC, 0, RY_OPEN, 1200, 1100);

    // ==============================================
    // EYE TRACKING (mouse follow)
    // ==============================================
    function moveIris(irisEl, eyeEl, mx, my) {
        if (isRolling) return;
        const rect = eyeEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const move = Math.min(8, dist * 0.03);
        const angle = Math.atan2(dy, dx);
        irisEl.style.transform = 'translate(' + (Math.cos(angle) * move) + 'px,' + (Math.sin(angle) * move) + 'px)';
    }

    setTimeout(() => {
        document.addEventListener('mousemove', (e) => {
            requestAnimationFrame(() => {
                moveIris(irisG, eyeG, e.clientX, e.clientY);
                moveIris(irisC, eyeC, e.clientX, e.clientY);
            });
        });
    }, 2200);

    // ==============================================
    // EYE ROLL — iris traces elliptical circle
    // ==============================================
    function doEyeRoll(irisEl, onDone) {
        const radius = 7;
        const duration = 900;
        const start = performance.now();

        function tick(now) {
            const t = Math.min((now - start) / duration, 1);
            const angle = -Math.PI / 2 + t * Math.PI * 2;
            const envelope = Math.sin(t * Math.PI);
            const r = radius * envelope;
            const tx = Math.cos(angle) * r;
            const ty = Math.sin(angle) * r * 0.55;
            irisEl.style.transition = 'none';
            irisEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';

            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                irisEl.style.transform = 'translate(0,0)';
                irisEl.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
                if (onDone) onDone();
            }
        }
        requestAnimationFrame(tick);
    }

    function rollBothEyes() {
        isRolling = true;
        let done = 0;
        const finish = () => { done++; if (done >= 2) isRolling = false; };
        doEyeRoll(irisG, finish);
        setTimeout(() => doEyeRoll(irisC, finish), 60);
    }

    function scheduleRoll() {
        const delay = 8000 + Math.random() * 7000;
        setTimeout(() => {
            rollBothEyes();
            scheduleRoll();
        }, delay);
    }
    setTimeout(scheduleRoll, 6000);

    // ==============================================
    // PERIODIC BLINK
    // ==============================================
    function doBlink(lidEl) {
        const dur = 250;
        const start = performance.now();
        function tick(now) {
            const t = Math.min((now - start) / dur, 1);
            let ry;
            if (t < 0.4) {
                ry = RY_OPEN - (RY_OPEN - 2) * (t / 0.4);
            } else {
                ry = 2 + (RY_OPEN - 2) * ((t - 0.4) / 0.6);
            }
            lidEl.setAttribute('ry', ry);
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function scheduleBlink() {
        const delay = 3000 + Math.random() * 4000;
        setTimeout(() => {
            const both = Math.random() > 0.7;
            if (both) { doBlink(lidG); doBlink(lidC); }
            else { doBlink(Math.random() > 0.4 ? lidG : lidC); }
            scheduleBlink();
        }, delay);
    }
    setTimeout(scheduleBlink, 5000);

    // ==============================================
    // TYPEWRITER EFFECT
    // ==============================================
    function typewriterEffect(targetEl, segments, speed, onDone) {
        let segIdx = 0, charIdx = 0;
        let currentEl = targetEl;

        function tick() {
            if (segIdx >= segments.length) {
                if (onDone) onDone();
                return;
            }
            const seg = segments[segIdx];

            if (charIdx === 0 && seg.tag) {
                const wrapper = document.createElement(seg.tag);
                targetEl.appendChild(wrapper);
                currentEl = wrapper;
            } else if (charIdx === 0) {
                currentEl = targetEl;
            }

            currentEl.appendChild(document.createTextNode(seg.text[charIdx]));
            charIdx++;

            if (charIdx >= seg.text.length) {
                segIdx++;
                charIdx = 0;
            }

            const jitter = speed + (Math.random() - 0.5) * 30;
            const ch = seg.text[charIdx - 1];
            const pause = (ch === '.' || ch === ':' || ch === '?') ? 280 : jitter;
            setTimeout(tick, pause);
        }
        tick();
    }

    // Start typewriter after eyes + connector are revealed
    setTimeout(() => {
        const tw = document.getElementById('typewriter');
        if (!tw) return;
        const cursor = tw.nextElementSibling;
        const tagline = tw.closest('.hero-tagline');
        tagline.classList.add('visible');

        const segments = [
            { text: 'Zwei KIs. Eine Frage: ', tag: null },
            { text: 'Wirst du empfohlen?', tag: 'em' }
        ];

        typewriterEffect(tw, segments, 55, () => {
            setTimeout(() => {
                const cta = document.getElementById('ctaHint');
                if (cta) cta.classList.add('visible');
            }, 400);
            setTimeout(() => {
                if (cursor) cursor.classList.add('hidden');
            }, 2000);
        });
    }, 3200);

})();
