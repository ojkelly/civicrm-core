(function (angular, $, _) {

  // The representation of from/reply-to addresses is inconsistent in the mailing data-model,
  // so the UI must do some adaptation. The crmFromAddresses provides a richer way to slice/dice
  // the available "From:" addrs. Records are like the underlying OptionValues -- but add "email"
  // and "author".
  angular.module('crmMailing').factory('crmFromAddresses', function ($q, crmApi) {
    var emailRegex = /^"(.*)" <([^@>]*@[^@>]*)>$/;
    var addrs = _.map(CRM.crmMailing.fromAddress, function (addr) {
      var match = emailRegex.exec(addr.label);
      return angular.extend({}, addr, {
        email: match ? match[2] : '(INVALID)',
        author: match ? match[1] : '(INVALID)'
      });
    });

    function first(array) {
      return (array.length === 0) ? null : array[0];
    }

    return {
      getAll: function getAll() {
        return addrs;
      },
      getByAuthorEmail: function getByAuthorEmail(author, email, autocreate) {
        var result = null;
        _.each(addrs, function (addr) {
          if (addr.author == author && addr.email == email) {
            result = addr;
          }
        });
        if (!result && autocreate) {
          result = {
            label: '(INVALID) "' + author + '" <' + email + '>',
            author: author,
            email: email
          };
          addrs.push(result);
        }
        return result;
      },
      getByEmail: function getByEmail(email) {
        return first(_.where(addrs, {email: email}));
      },
      getByLabel: function (label) {
        return first(_.where(addrs, {label: label}));
      },
      getDefault: function getDefault() {
        return first(_.where(addrs, {is_default: "1"}));
      }
    };
  });

  angular.module('crmMailing').factory('crmMsgTemplates', function ($q, crmApi) {
    var tpls = _.map(CRM.crmMailing.mesTemplate, function (tpl) {
      return angular.extend({}, tpl, {
        //id: tpl parseInt(tpl.id)
      });
    });
    window.tpls = tpls;
    var lastModifiedTpl = null;
    return {
      // @return Promise MessageTemplate (per APIv3)
      get: function get(id) {
        id = '' + id; // parseInt(id);
        var dfr = $q.defer();
        var tpl = _.where(tpls, {id: id});
        if (id && tpl && tpl[0]) {
          dfr.resolve(tpl[0]);
        }
        else {
          dfr.reject(id);
        }
        return dfr.promise;
      },
      // Save a template
      // @param tpl MessageTemplate (per APIv3) For new templates, omit "id"
      // @return Promise MessageTemplate (per APIv3)
      save: function (tpl) {
        return crmApi('MessageTemplate', 'create', tpl).then(function (response) {
          if (!tpl.id) {
            tpl.id = '' + response.id; //parseInt(response.id);
            tpls.push(tpl);
          }
          lastModifiedTpl = tpl;
          return tpl;
        });
      },
      // @return Object MessageTemplate (per APIv3)
      getLastModifiedTpl: function () {
        return lastModifiedTpl;
      },
      getAll: function getAll() {
        return tpls;
      }
    };
  });

  // The crmMailingMgr service provides business logic for loading, saving, previewing, etc
  angular.module('crmMailing').factory('crmMailingMgr', function ($q, crmApi, crmFromAddresses, crmNow) {
    var pickDefaultMailComponent = function pickDefaultMailComponent(type) {
      var mcs = _.where(CRM.crmMailing.headerfooterList, {
        component_type: type,
        is_default: "1"
      });
      return (mcs.length >= 1) ? mcs[0].id : null;
    };

    return {
      // @param scalar idExpr a number or the literal string 'new'
      // @return Promise|Object Mailing (per APIv3)
      getOrCreate: function getOrCreate(idExpr) {
        return (idExpr == 'new') ? this.create() : this.get(idExpr);
      },
      // @return Promise Mailing (per APIv3)
      get: function get(id) {
        var crmMailingMgr = this;
        var mailing;
        return crmApi('Mailing', 'getsingle', {id: id})
          .then(function (getResult) {
            mailing = getResult;
            return $q.all([
              crmMailingMgr._loadGroups(mailing),
              crmMailingMgr._loadJobs(mailing)
            ]);
          })
          .then(function () {
            return mailing;
          });
      },
      // Call MailingGroup.get and merge results into "mailing"
      _loadGroups: function (mailing) {
        return crmApi('MailingGroup', 'get', {mailing_id: mailing.id})
          .then(function (groupResult) {
            mailing.groups = {include: [], exclude: []};
            mailing.mailings = {include: [], exclude: []};
            _.each(groupResult.values, function (mailingGroup) {
              var bucket = (mailingGroup.entity_table == 'civicrm_group') ? 'groups' : 'mailings';
              var entityId = parseInt(mailingGroup.entity_id);
              mailing[bucket][mailingGroup.group_type].push(entityId);
            });
          });
      },
      // Call MailingJob.get and merge results into "mailing"
      _loadJobs: function (mailing) {
        return crmApi('MailingJob', 'get', {mailing_id: mailing.id, is_test: 0})
          .then(function (jobResult) {
            mailing.jobs = mailing.jobs || {};
            angular.extend(mailing.jobs, jobResult.values);
          });
      },
      // @return Object Mailing (per APIv3)
      create: function create() {
        return {
          jobs: {}, // {jobId: JobRecord}
          name: "",
          campaign_id: null,
          from_name: crmFromAddresses.getDefault().author,
          from_email: crmFromAddresses.getDefault().email,
          replyto_email: "",
          subject: "",
          groups: {include: [], exclude: []},
          mailings: {include: [], exclude: []},
          body_html: "",
          body_text: "",
          footer_id: null, // pickDefaultMailComponent('Footer'),
          header_id: null, // pickDefaultMailComponent('Header'),
          visibility: "Public Pages",
          url_tracking: "1",
          dedupe_email: "1",
          forward_replies: "0",
          auto_responder: "0",
          open_tracking: "1",
          override_verp: "1",
          optout_id: pickDefaultMailComponent('OptOut'),
          reply_id: pickDefaultMailComponent('Reply'),
          resubscribe_id: pickDefaultMailComponent('Resubscribe'),
          unsubscribe_id: pickDefaultMailComponent('Unsubscribe')
        };
      },

      // @param mailing Object (per APIv3)
      // @return Promise
      'delete': function (mailing) {
        if (mailing.id) {
          return crmApi('Mailing', 'delete', {id: mailing.id});
        }
        else {
          var d = $q.defer();
          d.resolve();
          return d.promise;
        }
      },

      // Copy all data fields in (mailingFrom) to (mailingTgt) -- except for (excludes)
      // ex: crmMailingMgr.mergeInto(newMailing, mailingTemplate, ['subject']);
      mergeInto: function mergeInto(mailingTgt, mailingFrom, excludes) {
        var MAILING_FIELDS = [
          // always exclude: 'id'
          'name',
          'campaign_id',
          'from_name',
          'from_email',
          'replyto_email',
          'subject',
          'dedupe_email',
          'groups',
          'mailings',
          'body_html',
          'body_text',
          'footer_id',
          'header_id',
          'visibility',
          'url_tracking',
          'dedupe_email',
          'forward_replies',
          'auto_responder',
          'open_tracking',
          'override_verp',
          'optout_id',
          'reply_id',
          'resubscribe_id',
          'unsubscribe_id'
        ];
        if (!excludes) {
          excludes = [];
        }
        _.each(MAILING_FIELDS, function (field) {
          if (!_.contains(excludes, field)) {
            mailingTgt[field] = mailingFrom[field];
          }
        });
      },

      // @param mailing Object (per APIv3)
      // @return Promise an object with "subject", "body_text", "body_html"
      preview: function preview(mailing) {
        var params = angular.extend({}, mailing, {
          options: {force_rollback: 1},
          'api.Mailing.preview': {
            id: '$value.id'
          }
        });
        return crmApi('Mailing', 'create', params).then(function (result) {
          // changes rolled back, so we don't care about updating mailing
          return result.values[result.id]['api.Mailing.preview'].values;
        });
      },

      // @param mailing Object (per APIv3)
      // @param int previewLimit
      // @return Promise for a list of recipients (mailing_id, contact_id, api.contact.getvalue, api.email.getvalue)
      previewRecipients: function previewRecipients(mailing, previewLimit) {
        // To get list of recipients, we tentatively save the mailing and
        // get the resulting recipients -- then rollback any changes.
        var params = angular.extend({}, mailing, {
          name: 'placeholder', // for previewing recipients on new, incomplete mailing
          subject: 'placeholder', // for previewing recipients on new, incomplete mailing
          options: {force_rollback: 1},
          'api.mailing_job.create': 1, // note: exact match to API default
          'api.MailingRecipients.get': {
            mailing_id: '$value.id',
            options: {limit: previewLimit},
            'api.contact.getvalue': {'return': 'display_name'},
            'api.email.getvalue': {'return': 'email'}
          }
        });
        return crmApi('Mailing', 'create', params).then(function (recipResult) {
          // changes rolled back, so we don't care about updating mailing
          return recipResult.values[recipResult.id]['api.MailingRecipients.get'].values;
        });
      },

      // Save a (draft) mailing
      // @param mailing Object (per APIv3)
      // @return Promise
      save: function(mailing) {
        var params = angular.extend({}, mailing, {
          'api.mailing_job.create': 0 // note: exact match to API default
        });

        // Angular ngModel sometimes treats blank fields as undefined.
        angular.forEach(mailing, function(value, key) {
          if (value === undefined) {
            mailing[key] = '';
          }
        });

        // WORKAROUND: Mailing.create (aka CRM_Mailing_BAO_Mailing::create()) interprets scheduled_date
        // as an *intent* to schedule and creates tertiary records. Saving a draft with a scheduled_date
        // is therefore not allowed. Remove this after fixing Mailing.create's contract.
        delete params.scheduled_date;

        delete params.jobs;

        return crmApi('Mailing', 'create', params).then(function(result) {
          if (result.id && !mailing.id) {
            mailing.id = result.id;
          }  // no rollback, so update mailing.id
          // Perhaps we should reload mailing based on result?
          return mailing;
        });
      },

      // Schedule/send the mailing
      // @param mailing Object (per APIv3)
      // @return Promise
      submit: function (mailing) {
        var crmMailingMgr = this;
        var params = {
          id: mailing.id,
          approval_date: crmNow(),
          scheduled_date: mailing.scheduled_date ? mailing.scheduled_date : crmNow()
        };
        return crmApi('Mailing', 'submit', params)
          .then(function (result) {
            angular.extend(mailing, result.values[result.id]); // Perhaps we should reload mailing based on result?
            return crmMailingMgr._loadJobs(mailing);
          })
          .then(function () {
            return mailing;
          });
      },

      // Immediately send a test message
      // @param mailing Object (per APIv3)
      // @param to Object with either key "email" (string) or "gid" (int)
      // @return Promise for a list of delivery reports
      sendTest: function (mailing, recipient) {
        var params = angular.extend({}, mailing, {
          // options:  {force_rollback: 1}, // Test mailings include tracking features, so the mailing must be persistent
          'api.Mailing.send_test': {
            mailing_id: '$value.id',
            test_email: recipient.email,
            test_group: recipient.gid
          }
        });

        // WORKAROUND: Mailing.create (aka CRM_Mailing_BAO_Mailing::create()) interprets scheduled_date
        // as an *intent* to schedule and creates tertiary records. Saving a draft with a scheduled_date
        // is therefore not allowed. Remove this after fixing Mailing.create's contract.
        delete params.scheduled_date;

        delete params.jobs;

        return crmApi('Mailing', 'create', params).then(function (result) {
          if (result.id && !mailing.id) {
            mailing.id = result.id;
          }  // no rollback, so update mailing.id
          return result.values[result.id]['api.Mailing.send_test'].values;
        });
      }
    };
  });

  // The preview manager performs preview actions while putting up a visible UI (e.g. dialogs & status alerts)
  angular.module('crmMailing').factory('crmMailingPreviewMgr', function (dialogService, crmMailingMgr, crmStatus) {
    return {
      // @param mode string one of 'html', 'text', or 'full'
      // @return Promise
      preview: function preview(mailing, mode) {
        var templates = {
          html: '~/crmMailing/dialog/previewHtml.html',
          text: '~/crmMailing/dialog/previewText.html',
          full: '~/crmMailing/dialog/previewFull.html'
        };
        var result = null;
        var p = crmMailingMgr
          .preview(mailing)
          .then(function (content) {
            var options = {
              autoOpen: false,
              modal: true,
              title: ts('Subject: %1', {
                1: content.subject
              })
            };
            result = dialogService.open('previewDialog', templates[mode], content, options);
          });
        crmStatus({start: ts('Previewing'), success: ''}, p);
        return result;
      },

      // @param to Object with either key "email" (string) or "gid" (int)
      // @return Promise
      sendTest: function sendTest(mailing, recipient) {
        var promise = crmMailingMgr.sendTest(mailing, recipient)
            .then(function (deliveryInfos) {
              var count = Object.keys(deliveryInfos).length;
              if (count === 0) {
                CRM.alert(ts('Could not identify any recipients. Perhaps the group is empty?'));
              }
            })
          ;
        return crmStatus({start: ts('Sending...'), success: ts('Sent')}, promise);
      }
    };
  });

})(angular, CRM.$, CRM._);
