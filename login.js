(function(){
  'use strict';

  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var rememberInput = document.getElementById('remember');
  var toggleBtn = document.getElementById('togglePassword');
  var submitBtn = document.getElementById('submitBtn');
  var errorBox = document.getElementById('formError');
  var emailField = document.getElementById('emailField');
  var passwordField = document.getElementById('passwordField');
  var loginPage = document.querySelector('.login-page');
  var tabs = document.querySelectorAll('.role-tab');
  var api = window.MJLA_API.api;
  var apiErrorMessage = window.MJLA_API.apiErrorMessage;

  /* Remember-me stores only the typed EMAIL, as a convenience for the next
     visit — never a password, token, or session value, and it never grants
     access on its own. The real session lives only in the HttpOnly cookie
     the server sets on a successful login. */
  try{
    var savedEmail = localStorage.getItem('milestoneRememberedEmail');
    if(savedEmail){ emailInput.value = savedEmail; rememberInput.checked = true; }
  }catch(_){}

  // Cosmetic only: the account's real role (returned by the server) decides
  // where sign-in lands, not whichever tab was showing when the form was
  // submitted, so a parent who leaves "Staff" selected still reaches the
  // parent portal correctly.
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      tabs.forEach(function(t){
        var active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
    });
  });

  toggleBtn.addEventListener('click', function(){
    var show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleBtn.classList.toggle('is-visible', show);
    toggleBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  function showError(message){
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError(){
    if(errorBox.hidden) return;
    errorBox.hidden = true;
    errorBox.textContent = '';
  }
  function setFieldInvalid(fieldEl, invalid){
    fieldEl.classList.toggle('has-error', invalid);
  }

  [ [emailInput, emailField], [passwordInput, passwordField] ].forEach(function(pair){
    pair[0].addEventListener('input', function(){
      setFieldInvalid(pair[1], false);
      clearError();
    });
  });

  var submitting = false;

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(submitting) return;
    clearError();

    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    var passwordValid = password.length > 0;

    setFieldInvalid(emailField, !emailValid);
    setFieldInvalid(passwordField, !passwordValid);

    if(!emailValid || !passwordValid){
      showError('Enter a valid email address and password to continue.');
      (!emailValid ? emailInput : passwordInput).focus();
      return;
    }

    try{
      if(rememberInput.checked) localStorage.setItem('milestoneRememberedEmail', email);
      else localStorage.removeItem('milestoneRememberedEmail');
    }catch(_){}

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.setAttribute('aria-busy', 'true');

    api.post('/api/auth/login', { email: email, password: password }).then(function(result){
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      submitBtn.removeAttribute('aria-busy');

      if(result.status === 429){
        showError('Too many attempts. Please wait a few minutes and try again.');
        return;
      }
      if(!result.ok || !result.data.user){
        // Same generic wording the server used, whatever the underlying reason.
        showError(apiErrorMessage(result, 'Email or password is incorrect.'));
        passwordInput.value = '';
        passwordInput.focus();
        return;
      }

      // The server's role decides the destination — not whatever tab the
      // visitor happened to have selected before signing in.
      var role = result.data.user.role;
      var destination = role === 'PARENT' ? 'parent.html' : 'admin.html';
      if(loginPage) loginPage.classList.add('is-leaving');
      setTimeout(function(){ window.location.href = destination; }, 280);
    }).catch(function(){
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      submitBtn.removeAttribute('aria-busy');
      showError('We could not reach the server. Please check your connection and try again.');
    });
  });

})();
