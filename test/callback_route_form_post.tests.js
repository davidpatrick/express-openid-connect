const assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const request = require('request-promise-native').defaults({
  simple: false,
  resolveWithFullResponse: true
});

const expressOpenid = require('..');
const server = require('./fixture/server');
const cert = require('./fixture/cert');
const clientID = '__test_client_id__';

function testCase(params) {
  return () => {
    const router = expressOpenid.auth({
      clientID: clientID,
      baseURL: 'https://example.org',
      issuerBaseURL: 'https://test.auth0.com',
      required: false
    });

    let baseUrl;

    const jar = request.jar();

    before(async function() {
      this.jar = jar;
      this.baseUrl = baseUrl = await server.create(router);
      await request.post({
        uri: '/session',
        baseUrl, jar,
        json: params.session
      });
    });

    before(async function() {
      this.response = await request.post('/callback', {
        baseUrl,
        jar,
        json: params.body
      });
    });

    before(async function() {
      this.currentSession = await request.get('/session', {
        baseUrl,
        jar,
        json: true,
      }).then(r => r.body);
    });

    params.assertions();
  };
}

//For the purpose of this test the fake SERVER returns the error message in the body directly
//production application should have an error middleware.
//http://expressjs.com/en/guide/error-handling.html


describe('callback routes response_type: id_token, response_mode: form_post', function() {
  describe('when body is empty', testCase({
    session: {
      nonce: '__test_nonce__',
      state: '__test_state__'
    },
    body: true,
    assertions() {
      it('should return 400', function() {
        assert.equal(this.response.statusCode, 400);
      });

      it('should return the reason to the error handler', function() {
        assert.equal(this.response.body.err.message, 'state missing from the response');
      });
    }
  }));

  describe("when state doesn't match", testCase({
    session: {
      nonce: '__test_nonce__',
      state: '__valid_state__'
    },
    body: {
      state: '__invalid_state__'
    },
    assertions() {
      it('should return 400', function() {
        assert.equal(this.response.statusCode, 400);
      });

      it('should return the reason to the error handler', function() {
        assert.match(this.response.body.err.message, /state mismatch/i);
      });
    }
  }));

  describe("when id_token can't be parsed", testCase({
    session: {
      nonce: '__test_nonce__',
      state: '__test_state__'
    },
    body: {
      state: '__test_state__',
      id_token: '__invalid_token__'
    },
    assertions() {
      it('should return 400', function() {
        assert.equal(this.response.statusCode, 400);
      });

      it('should return the reason to the error handler', function() {
        assert.match(this.response.body.err.message, /unexpected token/i);
      });
    }
  }));

  describe('when id_token has invalid alg', testCase({
    session: {
      nonce: '__test_nonce__',
      state: '__test_state__'
    },
    body: {
      state: '__test_state__',
      id_token: jwt.sign({sub: '__test_sub__'}, '__invalid_alg__')
    },
    assertions() {
      it('should return 400', function() {
        assert.equal(this.response.statusCode, 400);
      });

      it('should return the reason to the error handler', function() {
        assert.match(this.response.body.err.message, /unexpected JWT alg received/i);
      });
    }
  }));

  describe('when id_token is missing issuer', testCase({
    session: {
      nonce: '__test_nonce__',
      state: '__test_state__'
    },
    body: {
      state: '__test_state__',
      id_token: jwt.sign({sub: '__test_sub__'}, cert.key, { algorithm: 'RS256' })
    },
    assertions() {
      it('should return 400', function() {
        assert.equal(this.response.statusCode, 400);
      });

      it('should return the reason to the error handler', function() {
        assert.match(this.response.body.err.message, /missing required JWT property iss/i);
      });
    }
  }));

  describe('when id_token is valid', testCase({
    session: {
      state: '__test_state__',
      nonce: '__test_nonce__',
      returnTo: '/return-to'
    },
    body: {
      state: '__test_state__',
      id_token: jwt.sign({
        'nickname': '__test_nickname__',
        'name': '__test_name__',
        'email': '__test_email__',
        'email_verified': true,
        'iss': 'https://test.auth0.com/',
        'sub': '__test_sub__',
        'aud': clientID,
        'iat': Math.round(Date.now() / 1000),
        'exp': Math.round(Date.now() / 1000) + 60000,
        'nonce': '__test_nonce__'
      }, cert.key, { algorithm: 'RS256', header: { kid: cert.kid } })
    },
    assertions() {
      it('should return 302', function() {
        assert.equal(this.response.statusCode, 302);
      });

      it('should redirect to the intended url', function() {
        assert.equal(this.response.headers['location'], '/return-to');
      });

      it('should contain the claims in the current session', function() {
        assert.ok(this.currentSession.openidTokens);
      });

      it('should expose the user in the request', async function() {
        const res = await request.get('/user', {
          baseUrl: this.baseUrl,
          json: true,
          jar: this.jar
        });
        assert.equal(res.body.nickname, '__test_nickname__');
      });
    }
  }));

});
