const $=s=>document.querySelector(s); const $$=s=>document.querySelectorAll(s);
/* Contact details come from one place: src/siteConfig.js, published to the
   page by src/main.jsx before this script runs. Never hardcode a number here. */
const SITE=window.SITE||{};function waHref(message){return 'https://wa.me/'+SITE.whatsappDigits+(message?'?text='+encodeURIComponent(message):'')}
function track(name,meta={}){const events=JSON.parse(localStorage.getItem('milestoneAnalytics')||'[]');events.push({name,meta,time:new Date().toISOString(),path:location.hash||'home',source:new URLSearchParams(location.search).get('utm_source')||document.referrer||'direct'});localStorage.setItem('milestoneAnalytics',JSON.stringify(events.slice(-2000)));console.log('analytics',name)}track('homepage_visit');document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;const h=a.getAttribute('href')||'';if(h.startsWith('mailto:'))track('email_clicked');if(h.startsWith('tel:'))track('phone_clicked');if(h.includes('#contact-form'))track('school_tour_booking_started')});
const menu=$('.mobile-menu');const menuBtn=$('.menu-btn');function openMenu(){menu.classList.add('open');menuBtn.setAttribute('aria-expanded','true');const f=menu.querySelector('.close-menu');if(f)f.focus()}function closeMenu(){menu.classList.remove('open');menuBtn.setAttribute('aria-expanded','false');menuBtn.focus()}menuBtn.onclick=openMenu;$('.close-menu').onclick=closeMenu;$$('.mobile-menu a').forEach(a=>a.onclick=()=>closeMenu());
$('.theme-btn').onclick=()=>document.body.classList.toggle('dark');
const observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});$$('.reveal').forEach(e=>observer.observe(e));
const siteHeader=$('#siteHeader');if(siteHeader){document.addEventListener('scroll',()=>siteHeader.classList.toggle('scrolled',window.scrollY>8),{passive:true})}
/* ==========================================================================
   Enquiry forms — admissions application and contact message.

   ONLINE DELIVERY IS OFF. Neither form transmits anything anywhere. Submitting
   shows a notice saying online enquiries are still being set up, with real ways
   to reach the school. No success or "on its way" message exists in this file.

   Field values are never passed to track() or console.
   ========================================================================== */

const EMAIL_RE=/^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

/* ---------- inline, accessible field errors ---------- */

function errorBox(form,name){return document.getElementById(form.dataset.prefix+'-'+name+'-error')}

function clearErrors(form){
  form.querySelectorAll('.field-error').forEach(b=>b.textContent='');
  form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
}

function showErrors(form,errors){
  let first=null;
  for(const name of Object.keys(errors)){
    const el=form.querySelector('[name="'+name+'"]');
    const box=errorBox(form,name);
    if(box)box.textContent=errors[name];
    if(el){el.setAttribute('aria-invalid','true');if(!first)first=el}
  }
  if(first){
    // If the offending field sits on the other step of the apply form, show it.
    const stepEl=first.closest('.apply-step');
    if(stepEl&&!stepEl.classList.contains('active'))goToApplyStep(Number(stepEl.dataset.step));
    first.focus();
  }
  return Object.keys(errors).length===0;
}

/** Mirrors the server's rules so parents get feedback without a round trip. */
function validateFields(scope,form){
  const errors={};
  for(const el of scope.querySelectorAll('input[name], select[name], textarea[name]')){
    if(el.classList.contains('honeypot'))continue;
    const label=el.dataset.label||'This field';
    if(el.type==='checkbox'){
      if(el.required&&!el.checked)errors[el.name]='Please agree so we can reply to you.';
      continue;
    }
    const v=el.value.trim();
    if(el.required&&!v){errors[el.name]=label+' is required.';continue}
    if(v&&el.type==='email'&&!EMAIL_RE.test(v))errors[el.name]='Please enter a valid email address.';
  }
  return errors;
}

/* ---------- outcome panel ---------- */

function showOutcome(form,kind,message,actionsHTML){
  const box=form.querySelector('.form-outcome');
  const status=form.querySelector('.form-status');
  if(status)status.textContent='';
  if(!box)return;
  box.className='form-outcome is-'+kind;
  box.innerHTML='<p class="outcome-message">'+message+'</p><div class="outcome-actions">'+actionsHTML+'</div>';
  box.hidden=false;
  box.setAttribute('role','status');
  box.setAttribute('tabindex','-1');
  box.focus();
}

function resetOutcome(form){
  const box=form.querySelector('.form-outcome');
  if(box){box.hidden=true;box.innerHTML=''}
}

/* ---------- submission: ONLINE DELIVERY DISABLED ----------

   The Worker endpoint (/api/enquiry) exists and is tested, but no mail provider
   is configured and no official school inbox has been confirmed. Rather than
   post to an endpoint that cannot deliver, the forms send NOTHING and say so.

   Nothing is transmitted. No success is ever claimed. To re-enable delivery,
   restore postEnquiry()/submitEnquiry() from git history once RESEND_API_KEY,
   ENQUIRY_TO and ENQUIRY_FROM are set. See DEPLOYMENT.md section 4.
   --------------------------------------------------------------------------- */

const OFFLINE_TEXT='Online enquiries are being set up. For immediate assistance, please contact the school directly.';

function offlineActionsHTML(){
  const wa=waHref('Hello '+SITE.schoolName+', I would like to make an enquiry.');
  let html='<a class="btn btn-gold" target="_blank" rel="noopener" href="'+wa+'" onclick="track(\'whatsapp_clicked\')">Chat on WhatsApp ↗</a>'
    +'<a class="btn btn-outline" href="'+SITE.phonePrimaryHref+'">Call the School</a>';
  /* The email action is hidden unless the address is confirmed, so a parent is
     never sent to an inbox nobody is known to read. */
  if(SITE.emailOfficeConfirmed)html+='<a class="btn btn-outline" href="mailto:'+SITE.emailOffice+'">Email the School</a>';
  return html;
}

function showOfflineNotice(form){
  showOutcome(form,'notice',OFFLINE_TEXT,offlineActionsHTML());
}

/* ---------- apply modal ---------- */

let applyLastFocus=null;
let step=1;

function openApply(e){
  if(e)e.preventDefault();
  applyLastFocus=document.activeElement;
  $('#apply').classList.add('open');
  $('#apply').setAttribute('aria-hidden','false');
  track('apply_started');
  const f=$('#af-child');
  if(f)setTimeout(()=>f.focus(),60);
}

function closeApply(){
  $('#apply').classList.remove('open');
  $('#apply').setAttribute('aria-hidden','true');
  const form=$('#applyForm');
  form.reset();
  form.querySelector('.form-status').textContent='';
  clearErrors(form);
  resetOutcome(form);
  form.dataset.busy='0';
  form.querySelectorAll('.apply-step, #nextBtn').forEach(el=>el.hidden=false);
  goToApplyStep(1);
  if(applyLastFocus&&applyLastFocus.focus){applyLastFocus.focus();applyLastFocus=null}
}

function goToApplyStep(n){
  step=n;
  $$('.apply-step').forEach(x=>x.classList.toggle('active',Number(x.dataset.step)===n));
  $('#stepNum').textContent=String(n);
  $('#nextBtn').textContent=n===1?'Continue →':'Submit application ↗';
}

function validateActiveApplyStep(){
  const form=$('#applyForm');
  const active=form.querySelector('.apply-step.active');
  clearErrors(form);
  return showErrors(form,validateFields(active,form));
}

function nextStep(){
  /* Step 1 still validates so the two-step flow behaves normally. The final
     submit does not: nothing is transmitted, so making a parent complete every
     field before telling them enquiries are not live yet would be pure friction. */
  if(step===1){if(!validateActiveApplyStep())return;goToApplyStep(2)}
  else $('#applyForm').requestSubmit();
}

/** The WhatsApp message stays available as the "faster response" option. */
function buildApplicationMessage(form){
  const child=form.child.value.trim(),grade=form.grade.value.trim(),
        parent=form.parent.value.trim(),email=form.email.value.trim(),
        phone=form.phone.value.trim(),note=form.note.value.trim();
  let msg="Hello "+SITE.schoolName+",\n\nI would like to start an application for my child.\n\n*CHILD'S DETAILS*\nName: "+child+"\nGrade Applying For: "+grade+"\n\n*PARENT/GUARDIAN DETAILS*\nParent/Guardian Name: "+parent+"\nEmail Address: "+email+"\n";
  if(phone)msg+="Phone: "+phone+"\n";
  if(note)msg+="\nAdditional Information:\n"+note+"\n";
  msg+="\nThank you.";
  return msg;
}

async function submitApplication(e){
  e.preventDefault();
  const form=e.target;
  if(step!==2){nextStep();return}
  /* No validation gate and no request: nothing is sent, so demanding valid
     input before saying "we are not set up yet" would be pointless friction. */
  track('enquiry_attempted');
  showOfflineNotice(form);
}

/* ---------- contact form ---------- */

function sendMessage(e){
  e.preventDefault();
  /* Nothing is transmitted and the form is deliberately NOT cleared, so it is
     obvious the message was not taken. */
  track('enquiry_attempted');
  showOfflineNotice(e.target);
}

/* ---------- Turnstile (rendered only when a site key is configured) ---------- */

(function initTurnstile(){
  const slots=[...$$('.turnstile-slot')].filter(s=>s.dataset.sitekey);
  if(!slots.length)return;
  const s=document.createElement('script');
  s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async=true;s.defer=true;
  s.onload=()=>slots.forEach(slot=>window.turnstile?.render(slot,{sitekey:slot.dataset.sitekey}));
  document.head.appendChild(s);
})();

function showToast(t){let x=$('#toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',3500)}
/* Document requests. The PDFs in /downloads/ are placeholder stubs, so the
   download cards open this dialog instead of serving a non-functional file.
   Contact details come from window.SITE (src/siteConfig.js). */
let docLastFocus=null;function requestDocument(name){const m=$('#docModal');if(!m)return;docLastFocus=document.activeElement;$('#docModalTitle').textContent=name;const msg='Hello '+SITE.schoolName+', please could you send me the latest copy of the '+name+'?';$('#docWhatsApp').href=waHref(msg);$('#docPhone').href=SITE.phonePrimaryHref;$('#docEmail').href='mailto:'+SITE.emailOffice+'?subject='+encodeURIComponent('Document request: '+name)+'&body='+encodeURIComponent(msg);m.classList.add('open');m.setAttribute('aria-hidden','false');track('document_requested',{document:name});setTimeout(()=>m.querySelector('.modal-close').focus(),60)}
function closeDocModal(){const m=$('#docModal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');if(docLastFocus&&docLastFocus.focus){docLastFocus.focus();docLastFocus=null}}

/* Parent Portal "Coming Soon" panel. PHASE 1: every sign-in/login/portal-login
   control on the public site opens this instead of navigating to /login,
   /admin, /parent or /accept-invitation — none of which exist in this build.
   No account claim, no form, nothing to submit. */
let portalLastFocus=null;function openParentPortalModal(e){if(e)e.preventDefault();const m=$('#parentPortalModal');if(!m)return;portalLastFocus=document.activeElement;$('#portalWhatsApp').href=waHref('Hello '+SITE.schoolName+', I have a question for the school office.');$('#portalPhone').href=SITE.phonePrimaryHref;m.classList.add('open');m.setAttribute('aria-hidden','false');track('parent_portal_coming_soon_viewed');setTimeout(()=>m.querySelector('.modal-close').focus(),60)}
function closeParentPortalModal(){const m=$('#parentPortalModal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');if(portalLastFocus&&portalLastFocus.focus){portalLastFocus.focus();portalLastFocus=null}}

function filterGallery(category,button){$$('.gallery-filters button').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false')});button.classList.add('active');button.setAttribute('aria-pressed','true');$$('.gallery-item').forEach(item=>{item.hidden=category!=='all'&&!item.dataset.category.split(' ').includes(category)})}function openLightbox(button){const image=button.querySelector('img');const box=$('#lightbox');$('#lightboxImage').src=image.src;$('#lightboxImage').alt=image.alt;$('#lightboxCaption').textContent=button.parentElement.querySelector('figcaption').innerText;box.classList.add('open');box.setAttribute('aria-hidden','false')}function closeLightbox(){$('#lightbox').classList.remove('open');$('#lightbox').setAttribute('aria-hidden','true')}document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(menu.classList.contains('open')){closeMenu();return}if($('#apply').classList.contains('open')){closeApply();return}if($('#docModal')?.classList.contains('open')){closeDocModal();return}if($('#parentPortalModal')?.classList.contains('open')){closeParentPortalModal();return}if($('#articleModal').classList.contains('open')){closeArticle();return}closeLightbox()});

const articles={community:{title:'Growing together at Milestone',meta:'School life',image:'campus-children-2.webp',text:'At Milestone Junior Level Up Academy, every day is an opportunity to learn with joy. From Baby Class upward, our pupils develop confidence through caring relationships, purposeful routines, outdoor play and enriching experiences. We are proud of the warmth, energy and curiosity our children bring to school.'},team:{title:'Meet the team nurturing excellence',meta:'Announcement',image:'staff.webp',text:'Our dedicated team creates the conditions for children to feel safe, known and ready to learn. We combine strong foundations with encouragement, discipline and enrichment so that every learner can take their next step with confidence.'}};function openArticle(id){const a=articles[id],m=$('#articleModal');$('#articleImage').src=a.image;$('#articleImage').alt=a.title;$('#articleMeta').textContent=a.meta;$('#articleTitle').textContent=a.title;$('#articleText').textContent=a.text;$('#shareWhatsApp').href='https://wa.me/?text='+encodeURIComponent(a.title+' — Milestone Junior Level Up Academy '+location.href);m.classList.add('open');m.setAttribute('aria-hidden','false')}function closeArticle(){$('#articleModal').classList.remove('open');$('#articleModal').setAttribute('aria-hidden','true')}function copyArticleLink(){navigator.clipboard?.writeText(location.href);showToast('Article link copied ✓')}

let deferredInstall;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;setTimeout(()=>$('#installPrompt')?.classList.add('show'),1800)});function installPWA(){if(!deferredInstall){showToast('Use your browser menu and choose Add to Home Screen');return}deferredInstall.prompt();deferredInstall.userChoice.then(()=>{deferredInstall=null;dismissInstall()})}function dismissInstall(){$('#installPrompt')?.classList.remove('show');localStorage.setItem('milestoneInstallDismissed','true')}



/* $$ returns a NodeList, which has forEach but no map — spread before mapping. */
let testimonialIndex=0;function changeTestimonial(dir){const cards=[...$$('.testimonial')];if(!cards.length)return;testimonialIndex=(testimonialIndex+dir+cards.length)%cards.length;cards.forEach((c,i)=>c.classList.toggle('active',i===testimonialIndex));$('#testimonialDots').textContent=cards.map((_,i)=>i===testimonialIndex?'●':'○').join(' ')}


/* Preview banner. Session-only: reappears in a new tab so reviewers always see
   it once. Remove this, the markup block, and the noindex tag before launch. */
(function initPreviewBanner(){
  const b=$('#previewBanner');
  if(!b)return;
  try{if(sessionStorage.getItem('milestonePreviewDismissed')==='1')b.hidden=true}catch{}
})();
function dismissPreviewBanner(){
  const b=$('#previewBanner');
  if(b)b.hidden=true;
  try{sessionStorage.setItem('milestonePreviewDismissed','1')}catch{}
}
