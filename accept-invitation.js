(function(){
  'use strict';

  var api = window.MJLA_API.api;
  var apiErrorMessage = window.MJLA_API.apiErrorMessage;

  var form = document.getElementById('acceptForm');
  var linkError = document.getElementById('linkError');
  var pageTitle = document.getElementById('pageTitle');
  var pageSubtitle = document.getElementById('pageSubtitle');
  var passwordInput = document.getElementById('password');
  var confirmInput = document.getElementById('confirmPassword');
  var passwordField = document.getElementById('passwordField');
  var toggleBtn = document.getElementById('togglePassword');
  var submitBtn = document.getElementById('submitBtn');
  var formError = document.getElementById('formError');

  var token = new URLSearchParams(window.location.search).get('token');

  function showLinkError(message){
    pageTitle.textContent = 'This link is not usable.';
    pageSubtitle.textContent = '';
    linkError.textContent = message;
    linkError.hidden = false;
  }

  if(!token){
    showLinkError('This invitation link is missing its token. Please use the exact link the school sent you.');
    return;
  }

  form.hidden = false;

  toggleBtn.addEventListener('click', function(){
    var show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleBtn.classList.toggle('is-visible', show);
  });

  function showFormError(message){
    formError.textContent = message;
    formError.hidden = false;
  }
  function clearFormError(){
    formError.hidden = true;
    formError.textContent = '';
  }

  [passwordInput, confirmInput].forEach(function(el){
    el.addEventListener('input', function(){
      clearFormError();
      passwordField.classList.remove('has-error');
    });
  });

  var submitting = false;

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(submitting) return;
    clearFormError();

    var password = passwordInput.value;
    var confirm = confirmInput.value;

    if(password.length < 10){
      passwordField.classList.add('has-error');
      showFormError('Please choose a password of at least 10 characters.');
      passwordInput.focus();
      return;
    }
    if(password !== confirm){
      showFormError('Those passwords do not match. Please re-enter them.');
      confirmInput.focus();
      return;
    }

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');

    api.post('/api/auth/accept-invitation', { token: token, password: password }).then(function(result){
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');

      if(!result.ok || !result.data.user){
        showFormError(apiErrorMessage(result, 'This invitation link is no longer valid. It may have expired or already been used — please ask the school office to send a new one.'));
        return;
      }

      var destination = result.data.user.role === 'PARENT' ? 'parent.html' : 'admin.html';
      pageTitle.textContent = 'You are all set.';
      pageSubtitle.textContent = 'Taking you to your account...';
      form.hidden = true;
      setTimeout(function(){ window.location.href = destination; }, 600);
    }).catch(function(){
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      showFormError('We could not reach the server. Please check your connection and try again.');
    });
  });

})();
