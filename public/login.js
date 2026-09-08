(function(){
  'use strict';

  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var rememberInput = document.getElementById('remember');
  var toggleBtn = document.getElementById('togglePassword');
  var submitBtn = document.getElementById('submitBtn');
  var errorBox = document.getElementById('formError');
  var tabs = document.querySelectorAll('.role-tab');
  var emailField = document.getElementById('emailField');
  var passwordField = document.getElementById('passwordField');
  var loginPage = document.querySelector('.login-page');

  var selectedRole = 'staff';

  function setRole(role){
    selectedRole = role;
    tabs.forEach(function(tab){
      var active = tab.dataset.role === role;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('active', active);
    });
  }

  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){ setRole(tab.dataset.role); });
  });

  // Restore a remembered email/role for convenience. This is a
  // client-side nicety only — it does not create or extend any
  // session, since there is no real backend yet.
  try{
    var saved = JSON.parse(localStorage.getItem('milestoneRememberedLogin') || 'null');
    if(saved){
      if(saved.email) emailInput.value = saved.email;
      if(saved.role === 'parent' || saved.role === 'staff') setRole(saved.role);
      rememberInput.checked = true;
    }
  }catch(_){}

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

    if(rememberInput.checked){
      localStorage.setItem('milestoneRememberedLogin', JSON.stringify({ email: email, role: selectedRole }));
    }else{
      localStorage.removeItem('milestoneRememberedLogin');
    }

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.setAttribute('aria-busy', 'true');

    // ------------------------------------------------------------------
    // Placeholder sign-in. This intentionally preserves the existing
    // fake-authentication behaviour used elsewhere in the project
    // (any non-empty email/password succeeds) rather than inventing
    // real auth. Swap the body of this function for a real Supabase
    // call when that work is approved — everything above and below it
    // (validation, loading state, remember-me, role routing) stays the same.
    // ------------------------------------------------------------------
    fakeAuthenticate(email, password).then(function(){
      if(selectedRole === 'staff'){
        localStorage.setItem('milestoneAdminSignedIn', 'true');
      }
      if(loginPage) loginPage.classList.add('is-leaving');
      setTimeout(function(){
        window.location.href = selectedRole === 'staff' ? 'admin.html' : 'parent.html';
      }, 320);
    });
  });

  function fakeAuthenticate(){
    return new Promise(function(resolve){
      setTimeout(resolve, 850);
    });
  }

})();
