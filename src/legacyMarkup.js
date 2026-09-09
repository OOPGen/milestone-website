import { contact, turnstileSiteKey } from './siteConfig.js';

export default `
<a class="skip-link" href="#top">Skip to main content</a>
<!-- PREVIEW ONLY — REMOVE BEFORE PUBLIC LAUNCH.
     Paired with the noindex tag in index.html. Both must go together. -->
<div class="preview-banner" id="previewBanner" role="status">
<span><b>Preview site</b> — content and online enquiries are being finalised.</span>
<button type="button" class="preview-close" onclick="dismissPreviewBanner()" aria-label="Hide preview notice">×</button>
</div>
<div class="announcement"><span><b>Admissions are open</b> at Milestone — Baby Class to Grade 2</span><a href="#admissions">Start your application →</a></div>

<header class="site-header" id="siteHeader">
<a href="#top" class="brand"><span class="logo-wrap"><img class="school-logo" src="school-logo.webp" width="1080" height="959" alt="Milestone Junior Level Up Academy logo"/></span></a>
<nav class="desktop-nav" aria-label="Main">
<a href="#about">About Us</a>
<a href="#programs">Learning</a>
<a href="#gallery">School Life</a>
<a href="#parent-tools">Parents</a>
<a href="#admissions">Admissions</a>
<a href="#news-events">News &amp; Events</a>
<a href="#contact">Contact</a>
</nav>
<div class="nav-actions">
<button class="theme-btn" aria-label="Toggle dark mode">☾</button>
<button class="signin-link" aria-haspopup="dialog" onclick="openParentPortalModal(event)">Parent Portal — Coming Soon</button>
<a class="btn btn-sm" href="#admissions">Apply Now</a>
</div>
<button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobileMenu">☰</button>
</header>

<div class="mobile-menu" id="mobileMenu">
<button class="close-menu" aria-label="Close menu" style="align-self:flex-end">×</button>
<span class="eyebrow">Explore Milestone</span>
<nav aria-label="Mobile">
<a href="#about">About Us</a>
<a href="#programs">Learning</a>
<a href="#gallery">School Life</a>
<a href="#parent-tools">Parents</a>
<a href="#admissions">Admissions</a>
<a href="#news-events">News &amp; Events</a>
<a href="#contact">Contact</a>
</nav>
<button class="mobile-signin" aria-haspopup="dialog" onclick="closeMenu();openParentPortalModal(event)">Parent Portal — Coming Soon</button>
<button class="mobile-theme" onclick="document.querySelector('.theme-btn').click();closeMenu()">☾ Day / night mode</button>
<a class="btn" href="#admissions">Apply Now</a>
</div>

<main id="top">

<section class="hero">
<div class="brand-media">
<img
  src="campus-hero-1200.webp"
  srcset="campus-hero-800.webp 800w, campus-hero-1200.webp 1200w, campus-hero-1800.webp 1800w"
  sizes="100vw"
  width="1200" height="900"
  alt="Milestone Junior Level Up Academy pupils gathered outside the Gweru campus"
  loading="eager" fetchpriority="high" decoding="async"
/>
</div>
<div class="hero-scrim"></div>
<div class="hero-content">
<span class="eyebrow on-dark">Welcome to Milestone</span>
<h1>Beginning of a new <em>chapter</em> to excellence.</h1>
<p>Dedicated to nurturing excellence and providing a total quality education — welcoming children from Baby Class to Grade 2 into a safe, caring community where curiosity grows into confidence.</p>
<div class="hero-actions">
<a class="btn btn-gold" href="#contact-form" onclick="track('school_tour_booking_started')">Book a Visit</a>
<a class="btn btn-ghost" href="#about">Explore Our School</a>
</div>
</div>
</section>

<div class="trust-strip" aria-label="Why families choose Milestone">
<div><b>Baby Class to Grade 2</b><span>Learning pathways for little beginnings</span></div>
<div><b>Qualified &amp; dedicated staff</b><span>Teachers who know every child</span></div>
<div><b>Robotics, Golf, Music &amp; Computers</b><span>Future-ready enrichment</span></div>
<div><b>Gweru, Zimbabwe</b><span>1838 Raylands Park Estate</span></div>
</div>

<section id="about" class="section intro">
<div class="intro-visual reveal">
<div class="intro-image"><img src="staff.webp" alt="Milestone Junior Level Up Academy teachers standing outside the school" loading="lazy" width="810" height="1080" decoding="async"/></div>
<div class="intro-badge">A new chapter<em>to excellence.</em></div>
</div>
<div class="intro-copy reveal">
<span class="eyebrow">A place to grow</span>
<h2>Small beginnings.<br/><em>Big milestones.</em></h2>
<p class="lead">Milestone Junior Level Up Academy is a warm, forward-thinking junior school where every child is seen, heard and inspired to grow.</p>
<p>Dedicated to nurturing excellence and providing a total quality education, our classrooms pair strong foundations with enriching experiences that make learning feel like an adventure.</p>
<a class="text-link" href="#programs">Discover Our Story →</a>
<!-- EDITABLE: replace this line with verified school facts when the school
     confirms them (e.g. class sizes, enrichment programmes). Keep it
     non-numerical until those figures are confirmed in writing. -->
<p class="intro-note">Curiosity encouraged every day.</p>
</div>
</section>

<section class="section why-us">
<div class="section-head reveal">
<div><span class="eyebrow">Why families choose us</span><h2>A school built<br/><em>around your child.</em></h2></div>
<p>Three things every Milestone family tells us matter most — and three things we work at every single day.</p>
</div>
<div class="why-grid">
<article class="why-card reveal">
<div class="why-card-img"><img src="campus-children-1.webp" alt="Milestone pupils in school uniform outside the Gweru campus" loading="lazy" width="1080" height="810" decoding="async"/></div>
<div class="why-card-body"><h3>Nurturing Learning</h3><p>Gentle routines, purposeful teaching and dedicated staff who know every child by name — from their first day in Baby Class onward.</p><a class="text-link" href="#programs">Explore learning →</a></div>
</article>
<article class="why-card reveal">
<div class="why-card-img"><img src="campus-play-2.webp" alt="Milestone pupils playing together on the outdoor playground" loading="lazy" width="720" height="1280" decoding="async"/></div>
<div class="why-card-body"><h3>Confident Children</h3><p>Robotics, golf, music and computers give every learner room to discover a strength, try something new and grow in confidence.</p><a class="text-link" href="#gallery">See school life →</a></div>
</article>
<article class="why-card reveal">
<div class="why-card-img"><img src="staff-2.webp" alt="Milestone Junior Level Up Academy staff team outside the school" loading="lazy" width="720" height="1280" decoding="async"/></div>
<div class="why-card-body"><h3>A Vibrant Community</h3><p>A safe, caring environment where children belong and families are known — supported by a team dedicated to every learner's next milestone.</p><a class="text-link" href="#parent-tools">Meet our community →</a></div>
</article>
</div>
</section>

<section id="programs" class="section">
<div class="section-head reveal">
<div><span class="eyebrow">Learning pathways</span><h2>Room to grow,<br/><em>space to shine.</em></h2></div>
<p>From Baby Class, our dedicated staff spark curiosity through Robotics, Golf, Music and Computers.</p>
</div>
<div class="journey-grid">
<article class="journey-card reveal">
<img src="campus-children-2.webp" alt="Baby Class pupils at Milestone Junior Level Up Academy" loading="lazy" width="1080" height="810" decoding="async"/>
<div class="journey-card-body"><span class="journey-num">01</span><h3>Baby Class</h3><span class="journey-age">Ages 2–3</span><p>Gentle routines, sensory play and first friendships in a nurturing space.</p><a href="#admissions">Explore Learning →</a></div>
</article>
<article class="journey-card reveal">
<img src="campus-children-3.webp" alt="Nursery pupils at Milestone Junior Level Up Academy" loading="lazy" width="1080" height="810" decoding="async"/>
<div class="journey-card-body"><span class="journey-num">02</span><h3>Nursery</h3><span class="journey-age">Ages 3–5</span><p>Play-led learning that turns every question into a new possibility.</p><a href="#admissions">Explore Learning →</a></div>
</article>
<article class="journey-card reveal">
<img src="campus-play.webp" alt="Grade 1 pupils at Milestone Junior Level Up Academy" loading="lazy" width="1080" height="810" decoding="async"/>
<div class="journey-card-body"><span class="journey-num">03</span><h3>Grade 1</h3><span class="journey-age">Ages 5–6</span><p>Confident literacy, numeracy and a love of independent discovery.</p><a href="#admissions">Explore Learning →</a></div>
</article>
<article class="journey-card reveal">
<img src="social-preview.webp" alt="Grade 2 pupils at Milestone Junior Level Up Academy" loading="lazy" width="1200" height="630" decoding="async"/>
<div class="journey-card-body"><span class="journey-num">04</span><h3>Grade 2</h3><span class="journey-age">Ages 6–7</span><p>Building bright thinkers who connect ideas and lead with kindness.</p><a href="#admissions">Explore Learning →</a></div>
</article>
</div>
</section>

<section id="admissions" class="section" style="padding-top:0">
<div class="admissions-band">
<div class="admissions-head">
<span class="eyebrow on-dark">Your next step</span>
<h2>Your child's next<br/><em style="color:var(--gold-soft);font-style:normal">chapter starts here.</em></h2>
<p>We'd love to welcome your family for a conversation, a tour and a glimpse of the everyday magic at Milestone. Applications for Baby Class to Grade 2 are open now.</p>
</div>
<div class="admissions-cta-row">
<a class="btn btn-gold" href="#apply" onclick="openApply(event)">Start an Enquiry ↗</a>
<a class="btn btn-ghost" href="#contact">Contact Admissions</a>
</div>
<div class="admissions-steps">
<div class="admissions-step"><b>01</b><strong>Enquire</strong><span>Tell us about your child</span></div>
<div class="admissions-step"><b>02</b><strong>Visit</strong><span>See our learning in action</span></div>
<div class="admissions-step"><b>03</b><strong>Apply</strong><span>Begin your new chapter</span></div>
<div class="admissions-step"><b>04</b><strong>Join Our Community</strong><span>Welcome to Milestone</span></div>
</div>
<p class="admissions-note">Speak to the school office for current intake dates and availability.</p>
</div>
</section>

<section id="gallery" class="section">
<div class="section-head reveal">
<div><span class="eyebrow">Life at Milestone</span><h2>Campus <em>pulse.</em></h2></div>
<p>A glimpse of the people, place and joyful moments that make our school community feel like home.</p>
</div>
<div class="gallery-filters" role="group" aria-label="Filter gallery">
<button class="active" aria-pressed="true" onclick="filterGallery('all',this)">All</button>
<button aria-pressed="false" onclick="filterGallery('pupils',this)">Pupils</button>
<button aria-pressed="false" onclick="filterGallery('teachers',this)">Teachers</button>
<button aria-pressed="false" onclick="filterGallery('campus',this)">Campus</button>
<button aria-pressed="false" onclick="filterGallery('activities',this)">Activities</button>
</div>
<div class="mosaic reveal">
<figure class="gallery-item" data-category="pupils campus"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View pupils outside the school"><img loading="lazy" src="campus-hero-800.webp" srcset="campus-hero-800.webp 800w, campus-hero-1200.webp 1200w" sizes="(max-width:900px) 100vw, 50vw" alt="Milestone pupils in school tracksuits outside the Gweru campus" width="800" height="600" decoding="async"/></button><figcaption><b>Our pupils, our pride</b><span>A joyful start to every school day.</span></figcaption></figure>
<figure class="gallery-item" data-category="teachers campus"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View Milestone teachers"><img loading="lazy" src="staff.webp" alt="Milestone Junior Level Up Academy teachers standing outside the school" width="810" height="1080" decoding="async"/></button><figcaption><b>Teachers who care</b><span>Dedicated staff supporting every milestone.</span></figcaption></figure>
<figure class="gallery-item" data-category="pupils"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View pupils in uniform"><img loading="lazy" src="campus-children-1.webp" alt="Milestone children wearing grey and purple school uniforms" width="1080" height="810" decoding="async"/></button><figcaption><b>Growing in confidence</b><span>Learning, friendship and belonging.</span></figcaption></figure>
<figure class="gallery-item" data-category="pupils activities"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View pupils playing outside"><img loading="lazy" src="campus-play-2.webp" alt="Milestone pupils playing together on the outdoor playground" width="720" height="1280" decoding="async"/></button><figcaption><b>Room to play</b><span>Outdoor play that builds connection and courage.</span></figcaption></figure>
<figure class="gallery-item" data-category="activities campus"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View a Milestone school group"><img loading="lazy" src="campus-children-2.webp" alt="Milestone pupils gathered together outside the school building" width="1080" height="810" decoding="async"/></button><figcaption><b>Community in action</b><span>Every child has a place in our story.</span></figcaption></figure>
<figure class="gallery-item" data-category="pupils campus"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View pupils in school uniform"><img loading="lazy" src="campus-children-3.webp" alt="Milestone pupils in purple and grey uniforms at the school entrance" width="1080" height="810" decoding="async"/></button><figcaption><b>Ready for the next step</b><span>Beginning a new chapter to excellence.</span></figcaption></figure>
<figure class="gallery-item" data-category="pupils activities"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View pupils on the playground"><img loading="lazy" src="campus-play.webp" alt="Milestone pupils enjoying outdoor play on the school playground" width="1080" height="810" decoding="async"/></button><figcaption><b>Joyful outdoor learning</b><span>Play, friendship and discovery in motion.</span></figcaption></figure>
<figure class="gallery-item" data-category="teachers"><button class="gallery-open" onclick="openLightbox(this)" aria-label="View Milestone teaching staff"><img loading="lazy" src="staff-2.webp" alt="Four Milestone Junior Level Up Academy teachers in school uniform" width="720" height="1280" decoding="async"/></button><figcaption><b>Our dedicated team</b><span>Teachers who nurture every next milestone.</span></figcaption></figure>
</div>
<p class="photo-consent">Photography shared with permission from the school community. <a href="mailto:${contact.emailOffice}?subject=Photography%20consent">Contact the school about photo consent</a>.</p>
</section>

<section class="section testimonials">
<div class="testimonial-wrap">
<span class="eyebrow">Hear from our community</span>
<h2>Growing together,<br/><em>one story at a time.</em></h2>
<div class="testimonial-carousel">
<blockquote class="testimonial active">"Milestone has given our daughter the confidence to ask questions, try new things and walk into every day with a smile."<cite>— Chipo M., Milestone parent</cite></blockquote>
<blockquote class="testimonial">"From Baby Class, the teachers have created a warm place where our child feels known, encouraged and excited to learn."<cite>— Milestone parent · published with permission</cite></blockquote>
<div class="testimonial-controls"><button onclick="changeTestimonial(-1)" aria-label="Previous testimonial">←</button><span id="testimonialDots">● ○</span><button onclick="changeTestimonial(1)" aria-label="Next testimonial">→</button></div>
</div>
<p class="lead" style="margin:28px auto 0;text-align:center">Parent voices are published with permission. <a class="text-link" href="mailto:${contact.emailSecondary}?subject=Milestone%20parent%20testimonial">Share your story →</a></p>
</div>
</section>

<section id="parent-tools" class="section parent-hub">
<div class="section-head reveal">
<div><span class="eyebrow">For Milestone families</span><h2>Stay close to<br/><em>school life.</em></h2></div>
<p>Your parent space keeps the essentials in one place, from notices and term dates to documents and application updates.</p>
</div>
<div class="parent-grid">
<button type="button" class="parent-card featured" aria-haspopup="dialog" onclick="openParentPortalModal(event)"><span class="parent-card-icon">◌</span><b>Parent Portal — Coming Soon</b><small>Notices, term dates and your school calendar — on the way.</small><strong>Learn more →</strong></button>
<div class="parent-card"><span class="parent-card-icon">◷</span><b>Term &amp; events</b><small>Never miss a term date, meeting or celebration.</small><a href="#news-events"><strong>View calendar →</strong></a></div>
<div class="parent-card"><span class="parent-card-icon">▤</span><b>Uniform &amp; downloads</b><small>Prospectus, fees, uniform guide and handbook.</small><a href="#downloads"><strong>View documents →</strong></a></div>
<div class="parent-card"><span class="parent-card-icon">✉</span><b>Contact the school</b><small>Questions, visits or admissions support.</small><a href="#contact"><strong>Get in touch →</strong></a></div>
</div>
<!-- The newsletter sign-up was removed: the school has no confirmed newsletter
     process, mailing-list consent process, or owner for it, so collecting
     addresses would be collecting data nobody can act on. Restore a form here
     only once a real mailing list exists. See CONTENT-CHECKLIST.md. -->
<div class="newsletter-card connect-card reveal">
<div><span class="eyebrow">Stay in touch</span><h3>Stay connected with Milestone</h3><p>For school updates and admissions enquiries, contact our team directly on WhatsApp.</p></div>
<div class="connect-actions">
<a class="btn btn-gold" href="https://wa.me/${contact.whatsappDigits}?text=Hello%20Milestone%20Academy%2C%20I%27d%20like%20to%20enquire%20about%20admissions." target="_blank" rel="noopener" onclick="track('whatsapp_clicked')">Chat on WhatsApp ↗</a>
<a class="btn btn-outline" href="${contact.phonePrimaryHref}">Call the School</a>
</div>
</div>
<div id="downloads">
<!-- Downloads are intentionally DISABLED. The six PDFs in /downloads/ are
     ~850-byte placeholder stubs, not real school documents. Each card opens
     a request dialog instead of serving a file. Re-enable a card only when
     the school supplies the genuine document. See CONTENT-CHECKLIST.md. -->
<div class="download-grid">
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('School prospectus')"><span class="doc-tag">PDF</span><b>School prospectus</b><small>About Milestone and our learning journey</small><em class="doc-state">Being updated — request a copy →</em></button>
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('Fee structure')"><span class="doc-tag">PDF</span><b>Fee structure</b><small>Fees and payment information</small><em class="doc-state">Being updated — request a copy →</em></button>
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('Application form')"><span class="doc-tag">PDF</span><b>Application form</b><small>Admissions from Baby Class to Grade 2</small><em class="doc-state">Being updated — request a copy →</em></button>
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('School calendar')"><span class="doc-tag">PDF</span><b>School calendar</b><small>Term dates and key events</small><em class="doc-state">Being updated — request a copy →</em></button>
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('Uniform guide')"><span class="doc-tag">PDF</span><b>Uniform guide</b><small>What your child needs for school</small><em class="doc-state">Being updated — request a copy →</em></button>
<button type="button" class="download-card" aria-haspopup="dialog" onclick="requestDocument('Parent handbook')"><span class="doc-tag">PDF</span><b>Parent handbook</b><small>A connected start for every family</small><em class="doc-state">Being updated — request a copy →</em></button>
</div>
<p class="signed-note">Our documents are being updated. Tap any document above and the school office will send you the latest copy, or <a href="#contact">contact the office</a> directly.</p>
</div>
</section>

<section id="news-events" class="section news-events">
<div class="section-head reveal">
<div><span class="eyebrow">From the Milestone community</span><h2>News &amp; <em>events.</em></h2></div>
<p>Keep up with school announcements, important dates and the everyday moments that bring our community together.</p>
</div>
<div class="news-layout">
<div class="news-feed">
<article class="news-card featured-news reveal"><img src="campus-children-2.webp" loading="lazy" alt="Milestone pupils gathered outside the school" width="1080" height="810" decoding="async"><div class="news-card-copy"><span class="news-meta">School life</span><h3>Growing together at Milestone</h3><p>Our pupils are learning, playing and building confidence every day in a caring school community designed for joyful beginnings.</p><button class="text-link" onclick="openArticle('community')">Read full article →</button></div></article>
<article class="news-card reveal"><img src="staff.webp" loading="lazy" alt="Milestone teachers outside the school" width="810" height="1080" decoding="async"><div class="news-card-copy"><span class="news-meta">Announcement</span><h3>Meet the team nurturing excellence</h3><p>Dedicated staff, thoughtful teaching and a belief that every child can shine.</p><button class="text-link" onclick="openArticle('team')">Read full article →</button></div></article>
</div>
<aside class="events-card reveal">
<div class="events-card-head"><span class="eyebrow">Mark your calendar</span><a href="#contact">Ask a question →</a></div>
<!-- EDITABLE: term dates and events were removed because they had not been
     confirmed by the school. Restore .event-item entries here once the
     school supplies the real calendar. See CONTENT-CHECKLIST.md. -->
<div class="events-empty">
<p><b>Term dates are being confirmed.</b></p>
<p>Our calendar for the coming term is being finalised with the school office. Get in touch and we'll share the dates as soon as they're set.</p>
<a class="btn btn-gold" href="#contact">Ask about term dates</a>
</div>
</aside>
</div>
</section>

<div class="article-modal" id="articleModal" aria-hidden="true"><div class="article-modal-card"><button class="modal-close" onclick="closeArticle()">×</button><img id="articleImage" alt="" loading="lazy" width="1080" height="810"/><div class="article-body"><span class="news-meta" id="articleMeta"></span><h2 id="articleTitle"></h2><p id="articleText"></p><div class="article-share"><b>Share this story</b><a id="shareWhatsApp" target="_blank" rel="noopener">WhatsApp</a><button onclick="copyArticleLink()">Copy link</button></div></div></div></div>

<section class="section" style="padding-top:0">
<div class="final-cta">
<img src="campus-children-1.webp" alt="Milestone Junior Level Up Academy pupils outside the school" loading="lazy" width="1080" height="810" decoding="async"/>
<div class="final-cta-scrim"></div>
<div class="final-cta-body">
<span class="eyebrow on-dark">Come and visit</span>
<h2 style="color:#fff">Come and experience<br/><em style="color:var(--gold-soft);font-style:normal">Milestone for yourself.</em></h2>
<p>Our doors are open. Reach out to arrange a visit or ask anything about joining our community.</p>
<div class="final-cta-actions">
<a class="btn btn-gold" href="#contact-form">Book a Visit</a>
<a class="btn btn-ghost" href="#apply" onclick="openApply(event)">Enquire Now</a>
</div>
<div class="final-cta-contacts">
<a href="${contact.phonePrimaryHref}"><span>☎</span>${contact.phonePrimary}</a>
<a href="mailto:${contact.emailOffice}"><span>✉</span>${contact.emailOffice}</a>
<a href="https://wa.me/${contact.whatsappDigits}?text=Hello%20Milestone%20Academy%2C%20I%27d%20like%20to%20enquire%20about%20admissions." target="_blank" rel="noopener" onclick="track('whatsapp_clicked')"><span>◔</span>WhatsApp us</a>
</div>
</div>
</div>
</section>

<section id="contact" class="section contact">
<div class="contact-info reveal">
<span class="eyebrow">Come say hello</span>
<h2>Let's start<br/><em>the conversation.</em></h2>
<p>Our doors are open. Reach out to arrange a visit or ask anything about joining our community.</p>
<div class="contact-lines">
<a href="mailto:${contact.emailOffice}"><span>✉</span>${contact.emailOffice}</a>
<a href="mailto:${contact.emailSecondary}"><span>✉</span>${contact.emailSecondary}</a>
<a href="https://wa.me/${contact.whatsappDigits}" target="_blank" rel="noopener" onclick="track('whatsapp_clicked')"><span>◔</span>${contact.whatsappDisplay}</a>
<a href="tel:+${contact.whatsappDigits}"><span>☎</span>${contact.whatsappDisplay}</a>
<a href="${contact.phoneSecondaryHref}"><span>☎</span>${contact.phoneSecondary}</a>
<address><span>⌖</span>${contact.address}</address>
<p><span>◷</span>${contact.hours}</p>
</div>
<div class="hero-actions" style="margin-top:28px">
<a class="btn" href="https://wa.me/${contact.whatsappDigits}?text=Hello%20Milestone%20Academy%2C%20I%27d%20like%20to%20enquire%20about%20admissions." target="_blank" rel="noopener" onclick="track('whatsapp_clicked')">Chat on WhatsApp ↗</a>
<a class="btn btn-outline" href="${contact.phonePrimaryHref}">Call admissions</a>
</div>
<div class="map-card">
<div class="map-heading"><span class="eyebrow">Find us in Gweru</span><a href="https://www.google.com/maps/search/?api=1&query=${contact.addressQuery}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>
<iframe title="Milestone Junior Level Up Academy location map" src="https://www.google.com/maps?q=${contact.addressQuery}&output=embed" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
</div>
</div>
<form id="contact-form" class="message-form reveal" data-prefix="cf" novalidate onsubmit="sendMessage(event)">
<input class="honeypot" tabindex="-1" autocomplete="off" name="website" aria-hidden="true">
<h3>Send us a message</h3>
<p class="form-offline-note"><b>Online enquiries are being set up.</b> This form cannot send yet — the quickest way to reach us is WhatsApp or a phone call.</p>
<p class="form-privacy-note">We only use your details to reply to your enquiry — never shared or sold. Read our <a href="privacy.html">privacy policy</a>.</p>
<div class="field"><label for="cf-name">Your name</label><input id="cf-name" name="name" data-label="Your name" required autocomplete="name" placeholder="e.g. Tariro Moyo" aria-describedby="cf-name-error"/><span class="field-error" id="cf-name-error"></span></div>
<div class="field"><label for="cf-email">Email address</label><input id="cf-email" name="email" data-label="Email address" required type="email" autocomplete="email" placeholder="you@example.com" aria-describedby="cf-email-error"/><span class="field-error" id="cf-email-error"></span></div>
<div class="field"><label for="cf-phone">Phone or WhatsApp <span class="optional">(optional)</span></label><input id="cf-phone" name="phone" data-label="Phone number" type="tel" autocomplete="tel" placeholder="e.g. ${contact.phonePrimary}" aria-describedby="cf-phone-error"/><span class="field-error" id="cf-phone-error"></span></div>
<div class="field"><label for="cf-message">How can we help?</label><textarea id="cf-message" name="message" data-label="Your message" required rows="4" placeholder="I'd like to enquire about..." aria-describedby="cf-message-error"></textarea><span class="field-error" id="cf-message-error"></span></div>
<div class="field"><label class="consent" for="cf-consent"><input type="checkbox" id="cf-consent" name="consent" required aria-describedby="cf-consent-error"/><span>I agree that the school may use my details to respond to this enquiry.</span></label><span class="field-error" id="cf-consent-error"></span></div>
<div class="turnstile-slot" data-sitekey="${turnstileSiteKey}"></div>
<button class="btn" type="submit">Send Enquiry ↗</button>
<p class="form-status" role="status" aria-live="polite"></p>
<div class="form-outcome" hidden></div>
</form>
</section>

</main>

<footer>
<div class="footer-inner">
<div class="footer-brand"><span class="logo-wrap footer-logo"><img class="school-logo" src="school-logo.webp" alt="Milestone Junior Level Up Academy logo" width="1080" height="959" decoding="async"/></span><p>Beginning of a new chapter to excellence — dedicated to nurturing excellence and providing a total quality education in Gweru.</p></div>
<div class="footer-links">
<div><b>Explore</b><a href="#about">About us</a><a href="#programs">Learning</a><a href="#gallery">School life</a><a href="#news-events">News &amp; events</a></div>
<div><b>Parents</b><button type="button" class="footer-link-btn" aria-haspopup="dialog" onclick="openParentPortalModal(event)">Parent Portal — Coming Soon</button><a href="#parent-tools">Term dates</a><a href="#downloads">Downloads</a><a href="#contact">Contact the school</a></div>
<div><b>Admissions</b><a href="#admissions">Start an enquiry</a><a href="${contact.phonePrimaryHref}">Call admissions</a><a href="https://wa.me/${contact.whatsappDigits}" target="_blank" rel="noopener">WhatsApp us</a></div>
</div>
</div>
<div class="footer-bottom">
<span>© 2026 Milestone Junior Level Up Academy</span>
<span class="footer-legal"><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></span>
</div>
</footer>

<div id="apply" class="modal" role="dialog" aria-modal="true" aria-labelledby="applyTitle" aria-hidden="true"><div class="modal-card"><button class="modal-close" onclick="closeApply()">×</button><span class="eyebrow">Application · step <b id="stepNum">1</b> of 2</span><h2 id="applyTitle">Begin their<br/><em>next milestone.</em></h2><p class="form-offline-note"><b>Online enquiries are being set up.</b> This form cannot send yet — the quickest way to reach us is WhatsApp or a phone call.</p><form id="applyForm" data-prefix="af" novalidate onsubmit="submitApplication(event)"><input class="honeypot" tabindex="-1" autocomplete="off" name="website" aria-hidden="true"><div class="apply-step active" data-step="1"><div class="field"><label for="af-child">Child's full name</label><input id="af-child" name="child" data-label="The child's name" required placeholder="Child's name" aria-describedby="af-child-error"/><span class="field-error" id="af-child-error"></span></div><div class="field"><label for="af-grade">Applying for</label><select id="af-grade" name="grade" data-label="The class applied for" required aria-describedby="af-grade-error"><option value="">Select a program</option><option>Baby Class</option><option>Nursery</option><option>Grade 1</option><option>Grade 2</option></select><span class="field-error" id="af-grade-error"></span></div></div><div class="apply-step" data-step="2"><div class="field"><label for="af-parent">Parent / guardian name</label><input id="af-parent" name="parent" data-label="Your name" required autocomplete="name" placeholder="Your full name" aria-describedby="af-parent-error"/><span class="field-error" id="af-parent-error"></span></div><div class="field"><label for="af-email">Best email</label><input id="af-email" name="email" data-label="Email address" required type="email" autocomplete="email" placeholder="you@example.com" aria-describedby="af-email-error"/><span class="field-error" id="af-email-error"></span></div><div class="field"><label for="af-phone">Phone or WhatsApp <span class="optional">(optional)</span></label><input id="af-phone" name="phone" data-label="Phone number" type="tel" autocomplete="tel" placeholder="e.g. ${contact.phonePrimary}" aria-describedby="af-phone-error"/><span class="field-error" id="af-phone-error"></span></div><div class="field"><label for="af-note">Anything we should know? <span class="optional">(optional)</span></label><textarea id="af-note" name="note" rows="3" aria-describedby="af-note-error"></textarea><span class="field-error" id="af-note-error"></span></div><div class="field"><label class="consent" for="af-consent"><input type="checkbox" id="af-consent" name="consent" required aria-describedby="af-consent-error"/><span>I agree that the school may use my details to respond to this enquiry.</span></label><span class="field-error" id="af-consent-error"></span></div><p class="form-privacy-note">We only use these details to respond to your enquiry. Read our <a href="privacy.html">privacy policy</a>.</p><div class="turnstile-slot" data-sitekey="${turnstileSiteKey}"></div></div><button class="btn" type="button" id="nextBtn" onclick="nextStep()">Continue →</button><p class="form-status" role="status" aria-live="polite"></p><div class="form-outcome" hidden></div></form></div></div>

<!-- Document request dialog. Shown instead of downloading a placeholder file. -->
<div class="article-modal" id="docModal" role="dialog" aria-modal="true" aria-labelledby="docModalTitle" aria-hidden="true">
<div class="article-modal-card doc-modal-card">
<button class="modal-close" onclick="closeDocModal()" aria-label="Close">×</button>
<div class="article-body">
<span class="eyebrow">Document request</span>
<h2 id="docModalTitle">Document</h2>
<p>This document is being updated. Please contact the school office for the latest copy.</p>
<div class="doc-actions">
<a class="btn btn-gold" id="docWhatsApp" target="_blank" rel="noopener" onclick="track('whatsapp_clicked')">WhatsApp the office ↗</a>
<a class="btn btn-outline" id="docPhone" href="${contact.phonePrimaryHref}">Call the office</a>
<a class="btn btn-outline" id="docEmail">Email the office</a>
</div>
</div>
</div>
</div>
<!-- Parent Portal information panel. PHASE 1: the portal is not live — every
     sign-in/login/portal-login call-to-action on the public site opens this
     instead of navigating anywhere. No login form, no email/password field,
     no account-creation option, and no claim that parent accounts are active. -->
<div class="article-modal" id="parentPortalModal" role="dialog" aria-modal="true" aria-labelledby="parentPortalModalTitle" aria-hidden="true">
<div class="article-modal-card doc-modal-card">
<button class="modal-close" onclick="closeParentPortalModal()" aria-label="Close">×</button>
<div class="article-body">
<span class="eyebrow">Parent Portal</span>
<h2 id="parentPortalModalTitle">Parent Portal Coming Soon</h2>
<p>Our Parent Portal is currently being prepared. It will provide secure access to school notices, term dates, calendars, uniform information, and important documents.</p>
<p>For assistance today, please contact the school office.</p>
<div class="doc-actions">
<a class="btn btn-gold" id="portalWhatsApp" target="_blank" rel="noopener" onclick="track('whatsapp_clicked')">Chat on WhatsApp ↗</a>
<a class="btn btn-outline" id="portalPhone" href="${contact.phonePrimaryHref}">Call the School</a>
</div>
</div>
</div>
</div>
<div class="lightbox" id="lightbox" aria-hidden="true"><button onclick="closeLightbox()" aria-label="Close image viewer">×</button><img id="lightboxImage" alt=""/><p id="lightboxCaption"></p></div>
<div class="install-prompt" id="installPrompt"><div><b>Take Milestone with you</b><span>Install our parent-friendly school app for quick updates and applications.</span></div><button onclick="installPWA()">Install</button><button class="install-close" onclick="dismissInstall()">×</button></div>
<div class="toast" id="toast"></div>
<a class="whatsapp" href="https://wa.me/${contact.whatsappDigits}?text=Hello%20Milestone%20Academy%2C%20I%27d%20like%20to%20enquire%20about%20admissions." target="_blank" rel="noopener" aria-label="Chat on WhatsApp" onclick="track('whatsapp_clicked')">◔</a>
`;
