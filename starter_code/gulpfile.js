var child_process = require('child_process');
var gulp = require('gulp');
var mute = require('mute');
var mocha = require('mocha');
var phantomjs = require('phantomjs');
var request = require('request');
var fs = require('fs');
var q = require('q');

var cache = {};

function storeCache() {
    for (var key in require.cache) {
        cache[key] = true;
    }
}

function clearCache() {
    for (var key in require.cache) {
        if (!cache[key] && !(/\.node$/).test(key)) {
            delete require.cache[key];
        }
    }
}

function send(data) {
    var auth = {};
    var task = {};
    var pkg = JSON.parse(fs.readFileSync('./package.json'));
    task.repo = pkg.name;

    function git(cat) {
        var d = q.defer();

        if (task.type == 'local') {
            child_process.exec(`git config user.${cat}`, function(err, out, code) {
                if (err) {
                    d.reject(err);
                } else {
                    auth[cat] = out.trim();
                    d.resolve();
                }
            });
        } else if (task.type == 'travis' || task.type == 'docker') {
            var symbol;
            if (cat == 'email') {
                symbol = 'E';
            } else if (cat == 'name') {
                symbol = 'n';
            }
            child_process.exec(`git log -1 ${auth.commit_id} --pretty=%a${symbol}`, function(err, out, code) {
                if (err) {
                    d.reject(err);
                } else {
                    auth[cat] = out.trim();
                    d.resolve();
                }
            });
        }

        return d.promise;
    }

    function name() {
        return git("name");
    }

    function email() {
        return git("email");
    }

    function docker() {
        var d = q.defer();
        task.type = 'docker';
        auth['task_id'] = process.env.DOCKER_TASK_ID;
        auth['commit_id'] = process.env.DOCKER_COMMIT_ID;
        return name().then(email);
    }

    function travis() {
        task.type = 'travis';
        auth['job_id'] = process.env.TRAVIS_JOB_ID;
        auth['commit_id'] = process.env.TRAVIS_COMMIT;
        return name().then(email);
    }

    function local() {
        task.type = 'local';
        return name().then(email);
    }

    function post() {
        var d = q.defer();
        request.post('http://app.onexi.org/record', {
            body: {
                auth: auth,
                task: task,
                data: data
            },
            json: true
        }, function(err, res, body) {
            if (err) {
                d.reject(err);
            } else {
                d.resolve(body);
            }
        });
        return d.promise;
    }

    function id() {
        if (process.env.DOCKER_TASK_ID) {
            return docker();
        } else if (process.env.TRAVIS_JOB_ID) {
            return travis();
        } else {
            return local();
        }
    }

    return id()
        .then(post);
}

function capture() {
    var deferred = q.defer();

    return deferred.promise;
}


function test(reporter, silence) {
    var deferred = q.defer();
    storeCache();
    if (silence) unmute = mute();
    var m = new mocha({
        reporter: reporter
    });
    m.addFile('./test/test.js');
    r = m.run(function(failures) {
        var testResults = r.testResults;
        if (silence) unmute();
        clearCache();
        deferred.resolve(testResults);
    });
    return deferred.promise;
}

function record() {
    if (process.env.GULP) {
        var deferred = q.defer();
        deferred.resolve();
        return deferred.promise;
    } else {
        return test('json', true)
            .then(send);
    }
}

function display() {
    return test('list', false)
        .catch(function(err) {
            process.exit(1);
        });
}

gulp.task('test', function() {
    return record()
        .then(display);
});