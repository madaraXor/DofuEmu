var attach = function () {
  try {
    var gui = window.gui
    var auth = window.$_authManager
    var account = (auth && auth.account) || (gui && gui.account) || window.$_haapiAccount
    var authState = {}
    var defaultKeyTimeoutMs = 2592e6

    var getDofEmuTabId = function () {
      try {
        if (window.$game_id) return window.$game_id
        if (window.location && window.location.search) {
          var match = window.location.search.match(/[?&]id=([^&]+)/)
          if (match) return decodeURIComponent(match[1])
        }
      } catch (err) {}
      return null
    }

    var readLocalStorage = function (key) {
      try {
        return window.localStorage && window.localStorage.getItem(key)
      } catch (err) {
        return ''
      }
    }

    var getCertificatePart = function (certificate, methodName) {
      try {
        return certificate && typeof certificate[methodName] === 'function' ? certificate[methodName]() : ''
      } catch (err) {
        return ''
      }
    }

    var publishAuthState = function (partial, reason) {
      try {
        authState = Object.assign(authState, partial || {})

        var accountId = authState.accountId || window.$_pendingHaapiAccountId || readLocalStorage('HAAPI_ACCOUNTID')
        var accountKey = accountId ? String(accountId) : ''
        var apiKey = authState.apiKey || window.$_pendingApiKeyHeader || readLocalStorage('HAAPI_KEY')
        var refreshKey = authState.refreshKey || window.$_pendingRefreshKey || readLocalStorage('HAAPI_REFRESH_TOKEN')
        var keyTimeout = authState.keyTimeout || window.$_pendingHaapiKeyTimeout || readLocalStorage('HAAPI_KEY_TIMEOUT')
        var certificateId = authState.certificateId || window.$_authCertId || (accountKey && readLocalStorage(accountKey + '_CERTIFICATE_ID'))
        var certificateHash = authState.certificateHash || window.$_authCertHash || (accountKey && readLocalStorage(accountKey + '_CERTIFICATE_HASH'))

        if (!apiKey && !accountKey && !certificateId) return

        var payload = {
          apiKey: apiKey || '',
          refreshKey: refreshKey || '',
          keyTimeout: Number(keyTimeout || 0) || 0,
          accountId: accountKey,
          certificateId: certificateId || '',
          certificateHash: certificateHash || '',
          updatedAt: Date.now()
        }

        if (window.top && window.top.postMessage) {
          window.top.postMessage({ type: 'dofemu:auth-state', tabId: getDofEmuTabId(), auth: payload }, '*')
        }

        console.info(
          'DofEmu auth state',
          reason || 'update',
          'tab=' + (getDofEmuTabId() || 'unknown'),
          'account=' + (payload.accountId || 'none'),
          'apiKey=' + Boolean(payload.apiKey),
          'refresh=' + Boolean(payload.refreshKey),
          'certificate=' + Boolean(payload.certificateId && payload.certificateHash),
          'timeout=' + (payload.keyTimeout || 'none')
        )
      } catch (err) {
        console.error('DofEmu publish auth state failed:', err)
      }
    }

    if (gui && gui.playerData && typeof gui.playerData.setLoginName === 'function') {
      window.$_setLoginName = gui.playerData.setLoginName.bind(gui.playerData)
      if (window.parent && window.parent !== window) window.parent.$_setLoginName = window.$_setLoginName
    }

    if (account) {
      if (typeof account.createToken === 'function') {
        window.$_createToken = account.createToken.bind(account)
        if (window.parent && window.parent !== window) window.parent.$_createToken = window.$_createToken

        if (!window.$_createTokenWithParams) {
          window.$_createTokenWithParams = function (params, cb) {
            try {
              var payload = params || {}
              if (!payload.certificate_id && window.$_authCertId) payload.certificate_id = window.$_authCertId
              if (!payload.certificate_hash && window.$_authCertHash) payload.certificate_hash = window.$_authCertHash
              return account.createToken(payload, cb)
            } catch (err) {
              console.error('DofEmu createToken failed:', err)
            }
          }
          if (window.parent && window.parent !== window) window.parent.$_createTokenWithParams = window.$_createTokenWithParams
        }
      }

      if (typeof account.createTokenWithCertificate === 'function') {
        window.$_createTokenWithCertificate = account.createTokenWithCertificate.bind(account)
        if (window.parent && window.parent !== window) window.parent.$_createTokenWithCertificate = window.$_createTokenWithCertificate
      }
    }

    var mgr = auth && typeof auth.getHaapiKeyManager === 'function'
      ? auth.getHaapiKeyManager()
      : (window.$_haapiModule && typeof window.$_haapiModule.getHaapiKeyManager === 'function')
        ? window.$_haapiModule.getHaapiKeyManager()
        : null

    if (mgr) {
      if (!mgr.$_dofEmuPersistPatch) {
        mgr.$_dofEmuPersistPatch = true

        if (typeof mgr.setHaapiKey === 'function') {
          var originalSetHaapiKey = mgr.setHaapiKey.bind(mgr)
          mgr.setHaapiKey = function (apiKey, refreshKey, options) {
            var result = originalSetHaapiKey(apiKey, refreshKey, options)
            publishAuthState({
              apiKey: apiKey,
              refreshKey: refreshKey || '',
              keyTimeout: options && options.timeout
            }, 'setHaapiKey')
            return result
          }
        }

        if (typeof mgr.setHaapiAccountId === 'function') {
          var originalSetHaapiAccountId = mgr.setHaapiAccountId.bind(mgr)
          mgr.setHaapiAccountId = function (id, options) {
            var result = originalSetHaapiAccountId(id, options)
            publishAuthState({ accountId: id }, 'setHaapiAccountId')
            return result
          }
        }

        if (typeof mgr.setCertificate === 'function') {
          var originalSetCertificate = mgr.setCertificate.bind(mgr)
          mgr.setCertificate = function (certificate, options) {
            var result = originalSetCertificate(certificate, options)
            publishAuthState({
              certificateId: getCertificatePart(certificate, 'getId'),
              certificateHash: getCertificatePart(certificate, 'getEncodedData')
            }, 'setCertificate')
            return result
          }
        }

        if (typeof mgr._setCertificateToStorage === 'function') {
          var originalSetCertificateToStorage = mgr._setCertificateToStorage.bind(mgr)
          mgr._setCertificateToStorage = function (certificate) {
            var result = originalSetCertificateToStorage(certificate)
            publishAuthState({
              certificateId: getCertificatePart(certificate, 'getId'),
              certificateHash: getCertificatePart(certificate, 'getEncodedData')
            }, 'storeCertificate')
            return result
          }
        }
      }

      if (window.$_pendingHaapiAccountId && typeof mgr.setHaapiAccountId === 'function') {
        mgr.setHaapiAccountId(window.$_pendingHaapiAccountId, { save: true })
      }

      if (window.$_pendingApiKeyHeader && typeof mgr.setHaapiKey === 'function') {
        mgr.setHaapiKey(window.$_pendingApiKeyHeader, window.$_pendingRefreshKey || '', {
          save: true,
          timeout: window.$_pendingHaapiKeyTimeout || Date.now() + defaultKeyTimeoutMs
        })
      }

      publishAuthState({}, 'attach')

      if (!window.$_setHaapiKey && typeof mgr.setHaapiKey === 'function') {
        window.$_setHaapiKey = function (apiKey, refreshKey, options) {
          try { mgr.setHaapiKey(apiKey, refreshKey || '', options) } catch (err) { console.error('DofEmu setHaapiKey failed:', err) }
        }
        if (window.parent && window.parent !== window) window.parent.$_setHaapiKey = window.$_setHaapiKey
      }

      if (!window.$_getHaapiKey && typeof mgr.getHaapiKey === 'function') {
        window.$_getHaapiKey = function () {
          try { return mgr.getHaapiKey() } catch (err) { console.error('DofEmu getHaapiKey failed:', err); return null }
        }
        if (window.parent && window.parent !== window) window.parent.$_getHaapiKey = window.$_getHaapiKey
      }

      if (!window.$_setHaapiAccountId && typeof mgr.setHaapiAccountId === 'function') {
        window.$_setHaapiAccountId = function (id, options) {
          try { mgr.setHaapiAccountId(id, options) } catch (err) { console.error('DofEmu setHaapiAccountId failed:', err) }
        }
        if (window.parent && window.parent !== window) window.parent.$_setHaapiAccountId = window.$_setHaapiAccountId
      }

      if (!mgr.$_dofEmuApiKeyOnlyPatch && typeof mgr.getHaapiKey === 'function') {
        mgr.$_dofEmuApiKeyOnlyPatch = true
        var originalGetHaapiKey = mgr.getHaapiKey.bind(mgr)
        mgr.getHaapiKey = function () {
          try {
            var keyData = originalGetHaapiKey()
            if (keyData && keyData.key) return keyData
            var fallbackApiKey = window.$_pendingApiKeyHeader || (window.parent && window.parent.$_pendingApiKeyHeader)
            if (!fallbackApiKey && window.localStorage && typeof window.localStorage.getItem === 'function') {
              fallbackApiKey = window.localStorage.getItem('HAAPI_KEY')
            }
            return fallbackApiKey ? { key: fallbackApiKey, refreshToken: '' } : keyData
          } catch (err) {
            console.error('DofEmu getHaapiKey api-key patch failed:', err)
            return null
          }
        }
      }
    }

    if (account && typeof account.createToken === 'function') {
      window.$_haapiDirectLogin = function (opts, cb) {
        try {
          var o = opts || {}
          var localMgr = mgr
          var restoreGet = null
          if (localMgr && typeof localMgr.getHaapiKey === 'function' && o.apiKey) {
            restoreGet = localMgr.getHaapiKey.bind(localMgr)
            localMgr.getHaapiKey = function () {
              return { key: o.apiKey, refreshToken: o.refreshKey || '' }
            }
          }
          if (localMgr) {
            if (o.accountId && localMgr.setHaapiAccountId) localMgr.setHaapiAccountId(o.accountId, { save: o.save !== false })
            if (o.apiKey && localMgr.setHaapiKey) localMgr.setHaapiKey(o.apiKey, o.refreshKey || '', { save: o.save !== false })
          }
          if (o.certificateId) window.$_authCertId = o.certificateId
          if (o.certificateHash) window.$_authCertHash = o.certificateHash
          publishAuthState({
            apiKey: o.apiKey,
            refreshKey: o.refreshKey || '',
            accountId: o.accountId,
            certificateId: o.certificateId || '',
            certificateHash: o.certificateHash || '',
            keyTimeout: o.keyTimeout
          }, 'directLogin')
          var payload = Object.assign({}, o.params || {})
          if (!payload.certificate_id && o.certificateId) payload.certificate_id = o.certificateId
          if (!payload.certificate_hash && o.certificateHash) payload.certificate_hash = o.certificateHash
          var done = function (err, res) {
            if (restoreGet && localMgr) localMgr.getHaapiKey = restoreGet
            if (typeof cb === 'function') cb(err, res)
          }
          return account.createToken(payload, done)
        } catch (err) {
          console.error('DofEmu haapiDirectLogin failed:', err)
          if (typeof cb === 'function') cb(err)
        }
      }
      if (window.parent && window.parent !== window) window.parent.$_haapiDirectLogin = window.$_haapiDirectLogin
    }

    if (window.$_haapiModule && window.$_haapiModule.loginWithHaapiKey && !window.$_haapiModule.$_dofEmuPatched) {
      window.$_haapiModule.$_dofEmuPatched = true
      var haapiModule = window.$_haapiModule
      var keyManager = haapiModule.getHaapiKeyManager && haapiModule.getHaapiKeyManager()

      window.$_primeHaapiKey = function (apiKey, refreshKey, accountId, certificateId, certificateHash) {
        try {
          var km = (haapiModule.getHaapiKeyManager ? haapiModule.getHaapiKeyManager() : null) || keyManager
          if (km) {
            if (accountId && km.setHaapiAccountId) km.setHaapiAccountId(accountId, { save: true })
            if (apiKey && km.setHaapiKey) km.setHaapiKey(apiKey, refreshKey || '', { save: true })
          }
          if (window.localStorage) {
            window.localStorage.setItem('HAAPI_KEY', apiKey || '')
            window.localStorage.setItem('HAAPI_REFRESH_TOKEN', refreshKey || '')
            window.localStorage.setItem('HAAPI_KEY_TIMEOUT', Date.now() + defaultKeyTimeoutMs)
            if (typeof accountId === 'number') {
              window.localStorage.setItem('HAAPI_ACCOUNTID', accountId.toString())
              window.localStorage.setItem(accountId + '_CERTIFICATE_ID', certificateId || '')
              window.localStorage.setItem(accountId + '_CERTIFICATE_HASH', certificateHash || '')
            }
          }
          window.$_authCertId = certificateId || ''
          window.$_authCertHash = certificateHash || ''
          if (window.parent && window.parent !== window) {
            window.parent.$_authCertId = window.$_authCertId
            window.parent.$_authCertHash = window.$_authCertHash
          }
          publishAuthState({
            apiKey: apiKey,
            refreshKey: refreshKey || '',
            accountId: accountId,
            certificateId: certificateId || '',
            certificateHash: certificateHash || '',
            keyTimeout: Date.now() + defaultKeyTimeoutMs
          }, 'primeHaapiKey')
        } catch (err) {
          console.error('DofEmu primeHaapiKey failed:', err)
        }
      }

      window.$_finishDirectLogin = function (options) {
        try {
          var manager = haapiModule.getHaapiKeyManager()
          if (!manager || typeof manager.getHaapiAccountId !== 'function') throw new Error('No haapi key manager')
          var accountId = manager.getHaapiAccountId()
          if (!accountId) throw new Error('Missing account id')
          var forcedAccount = options && options.forcedAccount || ''
          window.gui.playerData.setForcedAccount(forcedAccount)
          window.dofus.setCredentials(accountId.toString(), options.token, forcedAccount)
          var loginName = options && (options.loginName || options.account)
          if (loginName) window.gui.playerData.setLoginName(loginName)
          window.gui.splashScreen.show()
          window.dofus.login(function (err, state) {
            if (err) {
              window.dofus.disconnect()
              console.error('Direct login failed', err)
              window.gui.loginScreen.displayAppropriateForm()
              return
            }
            if (state && state.disconnected) {
              window.dofus.disconnect()
              return
            }
            window.gui.initializeAfterLogin(function (initErr) {
              if (initErr) {
                console.error('initializeAfterLogin failed:', initErr)
                window.gui.openSimplePopup(window.gui.getText('ui.popup.connectionFailed.text'))
                window.gui.loginScreen.displayAppropriateForm()
              }
            })
          })
        } catch (err) {
          console.error('finishDirectLogin failed:', err)
          window.gui.loginScreen.displayAppropriateForm()
        }
      }
    }

    if (!window.$_dofEmuFetchPatched && typeof window.fetch === 'function') {
      window.$_dofEmuFetchPatched = true
      var originalFetch = window.fetch
      window.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : input && input.url ? input.url.toString() : ''
          var isHaapiV5 = url && url.indexOf('/json/Ankama/v5/') !== -1
          var shouldInjectApiKey = isHaapiV5 && url.indexOf('/Cms') === -1 && url.indexOf('/Forum') === -1
          if (shouldInjectApiKey) {
            init = init || {}
            var headers = init.headers && typeof init.headers === 'object' ? init.headers : {}
            var apiKey = window.$_pendingApiKeyHeader || (window.parent && window.parent.$_pendingApiKeyHeader)
            if (apiKey) {
              var hasApiKeyHeader = false
              if (typeof headers.forEach === 'function') {
                headers.forEach(function (_value, key) {
                  if (String(key).toLowerCase() === 'apikey') hasApiKeyHeader = true
                })
              } else {
                hasApiKeyHeader = Object.keys(headers).some(function (key) {
                  return String(key).toLowerCase() === 'apikey'
                })
              }
              if (!hasApiKeyHeader) {
                if (typeof headers.append === 'function') {
                  headers.append('APIKEY', apiKey)
                } else {
                  headers = Object.assign({}, headers, { APIKEY: apiKey })
                }
              }
              init.headers = headers
            }
          }
        } catch (err) {
          console.error('DofEmu fetch override failed:', err)
        }
        return originalFetch.call(this, input, init)
      }
    }
  } catch (err) {
    console.error('DofEmu expose helpers failed:', err)
  }
}
