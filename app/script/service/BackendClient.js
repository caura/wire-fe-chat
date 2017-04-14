/*
 * Wire
 * Copyright (C) 2017 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

'use strict';

window.z = window.z || {};
window.z.service = z.service || {};

const BACKEND_CLIENT_CONFIG = {
  IGNORED_BACKEND_ERRORS: [
    z.service.BackendClientError.STATUS_CODE.BAD_GATEWAY,
    z.service.BackendClientError.STATUS_CODE.BAD_REQUEST,
    z.service.BackendClientError.STATUS_CODE.CONFLICT,
    z.service.BackendClientError.STATUS_CODE.CONNECTIVITY_PROBLEM,
    z.service.BackendClientError.STATUS_CODE.INTERNAL_SERVER_ERROR,
    z.service.BackendClientError.STATUS_CODE.NOT_FOUND,
    z.service.BackendClientError.STATUS_CODE.PRECONDITION_FAILED,
    z.service.BackendClientError.STATUS_CODE.REQUEST_TIMEOUT,
    z.service.BackendClientError.STATUS_CODE.REQUEST_TOO_LARGE,
    z.service.BackendClientError.STATUS_CODE.TOO_MANY_REQUESTS,
  ],
  IGNORED_BACKEND_LABELS: [
    z.service.BackendClientError.LABEL.PASSWORD_EXISTS,
    z.service.BackendClientError.LABEL.TOO_MANY_CLIENTS,
    z.service.BackendClientError.LABEL.TOO_MANY_MEMBERS,
  ],
};

z.service.BackendClient = class BackendClient {
  /**
   * Construct a new client.
   *
   * @param {Object} settings - Settings for different backend environments
   * @param {string} settings.environment - Backend environment used
   * @param {string} settings.rest_url - Backend REST URL
   * @param {string} settings.web_socket_url - Backend WebSocket URL
   * @returns {BackendClient} Client for all backend REST API calls
  */
  constructor(settings) {
    this.logger = new z.util.Logger('z.service.BackendClient', z.config.LOGGER.OPTIONS);

    z.util.Environment.backend.current = settings.environment;
    this.rest_url = settings.rest_url;
    this.web_socket_url = settings.web_socket_url;

    this.request_queue = new z.util.PromiseQueue();
    this.request_queue_blocked_state = ko.observable(z.service.RequestQueueBlockedState.NONE);

    this.access_token = '';
    this.access_token_type = '';

    this.number_of_requests = ko.observable(0);
    this.number_of_requests.subscribe((new_value) => amplify.publish(z.event.WebApp.TELEMETRY.BACKEND_REQUESTS, new_value));

    // http://stackoverflow.com/a/18996758/451634
    $.ajaxPrefilter((options, originalOptions, jqXHR) => {
      jqXHR.wire = {
        original_request_options: originalOptions,
        request_id: this.number_of_requests(),
        requested: new Date(),
      };
    });

    return this;
  }

  /**
   * Create a request URL.
   * @param {string} url - API endpoint to be prefixed with REST API environment
   * @returns {String} REST API endpoint URL
   */
  create_url(url) {
    return `${this.rest_url}${url}`;
  }

  /**
   * Request backend status.
   * @returns {$.Promise} jquery AJAX promise
   */
  status() {
    return $.ajax({
      type: 'HEAD',
      timeout: 500,
      url: this.create_url('/self'),
    });
  }

  /**
   * Delay a function call until backend connectivity is guaranteed.
   * @returns {Promise} Resolves once the connectivity is verified
   */
  execute_on_connectivity() {
    return new Promise((resolve) => {
      const _check_status = () => {
        return this.status()
        .done((jqXHR) => {
          this.logger.info('Connectivity verified', jqXHR);
          return resolve();
        })
        .fail((jqXHR) => {
          if (jqXHR.readyState === 4) {
            this.logger.info(`Connectivity verified by server error '${jqXHR.status}'`, jqXHR);
            return resolve();
          }
          this.logger.warn('Connectivity could not be verified... retrying');
          return window.setTimeout(_check_status, 2000);
        });
      };

      return _check_status();
    });
  }

  /**
   * Execute queued requests.
   * @returns {undefined} No return value
   */
  execute_request_queue() {
    if (!this.access_token || !this.request_queue.get_length()) return;

    this.logger.info(`Executing '${this.request_queue.get_length()}' queued requests`);
    this.request_queue.pause(false);
  }

  /**
   * Send jQuery AJAX request with compressed JSON body.
   *
   * @note ContentType will be overwritten with 'application/json; charset=utf-8'
   * @see send_request for valid parameters
   *
   * @param {Object} config - AJAX request configuration
   * @returns {Promise} Resolves when the request has been executed
   */
  send_json(config) {
    const json_config = {
      contentType: 'application/json; charset=utf-8',
      data: config.data ? pako.gzip(JSON.stringify(config.data)) : undefined,
      headers: {
        'Content-Encoding': 'gzip',
      },
      processData: false,
    };

    return this.send_request($.extend(config, json_config, true));
  }

  /**
   * Send or queue jQuery AJAX request.
   * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
   *
   * @param {Object} config - AJAX request configuration
   * @param {string} config.contentType - Request content type
   * @param {Object} config.data - Request data payload
   * @param {Object} config.headers - Request headers
   * @param {Boolean} config.processData - Process data before sending
   * @param {Number} config.timeout - Request timeout
   * @param {string} config.type - Request type
   * @param {string} config.url - Request URL
   * @param {Boolean} config.withCredentials - Request send with credentials
   * @returns {Promise} Resolves when the request has been executed
   */
  send_request(config) {
    if (this.request_queue_blocked_state() !== z.service.RequestQueueBlockedState.NONE) {
      return this._push_to_request_queue(config, this.request_queue_blocked_state());
    }
    return this._send_request(config);
  }

  /**
   * Push a request to the queue
   *
   * @private
   * @param {Object} config - Configuration for the AJAX request
   * @param {string} reason - Reason for delayed execution of request
   * @returns {Promise} Resolved when the request has been executed
   */
  _push_to_request_queue(config, reason) {
    this.logger.info(`Adding '${config.type}' request to '${config.url}' to queue due to '${reason}'`, config);
    return this.request_queue.push(() => {
      this.logger.info(`Queued '${config.type}' request to '${config.url}' executed`);

      this._send_request(config)
        .catch((error) => {
          this.logger.info(`Failed to execute queued '${config.type}' request to '${config.url}'`, error);
          throw error;
        });
    });
  }

  /**
   * Send jQuery AJAX request.
   *
   * @private
   * @param {Object} config - Request configuration
   * @returns {Promise} Resolves when request has been executed
   */
  _send_request(config) {
    if (this.access_token) {
      config.headers = $.extend(config.headers || {}, {Authorization: `${this.access_token_type} ${this.access_token}`});
    }

    if (config.withCredentials) {
      config.xhrFields = {withCredentials: true};
    }

    this.number_of_requests(this.number_of_requests() + 1);

    return new Promise((resolve, reject) => {
      $.ajax({
        cache: config.cache,
        contentType: config.contentType,
        data: config.data,
        headers: config.headers,
        processData: config.processData,
        timeout: config.timeout,
        type: config.type,
        url: config.url,
        xhrFields: config.xhrFields})
      .done((data, textStatus, jqXHR) => {
        this.logger.debug(this.logger.levels.OFF, `Server Response '${(jqXHR.wire !== null ? jqXHR.wire.request_id : undefined)}' from '${config.url}':`, data);
        resolve(data);
      })
      .fail(({responseJSON: response, status: status_code}) => {
        switch (status_code) {
          case z.service.BackendClientError.STATUS_CODE.CONNECTIVITY_PROBLEM:
            this.request_queue.pause();
            this.request_queue_blocked_state(z.service.RequestQueueBlockedState.CONNECTIVITY_PROBLEM);
            this._push_to_request_queue(config, this.request_queue_blocked_state())
              .then(resolve)
              .catch(reject);
            this.execute_on_connectivity()
            .then(() => {
              this.request_queue_blocked_state(z.service.RequestQueueBlockedState.NONE);
              this.execute_request_queue();
            });
            break;
          case z.service.BackendClientError.STATUS_CODE.UNAUTHORIZED:
            this._push_to_request_queue(config, z.service.RequestQueueBlockedState.ACCESS_TOKEN_REFRESH)
              .then(resolve)
              .catch(reject);
            amplify.publish(z.event.WebApp.CONNECTION.ACCESS_TOKEN.RENEW, 'Unauthorized backend request');
            break;
          case z.service.BackendClientError.STATUS_CODE.FORBIDDEN:
            if (response && BACKEND_CLIENT_CONFIG.IGNORED_BACKEND_LABELS.includes(response.label)) {
              this.logger.warn(`Server request failed: ${response.label}`);
            } else {
              Raygun.send(new Error(`Server request failed: ${response.label}`));
            }
            break;
          default:
            if (!BACKEND_CLIENT_CONFIG.IGNORED_BACKEND_ERRORS.includes(status_code)) {
              Raygun.send(new Error(`Server request failed: ${status_code}`));
            }
        }
        return reject(response || new z.service.BackendClientError(status_code));
      });
    });
  }
};