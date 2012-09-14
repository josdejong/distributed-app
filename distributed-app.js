var fs = require('fs'),
    express = require('express'),         // http://expressjs.com/api.html
    request = require('request'),         // https://github.com/mikeal/request
    portscanner = require('portscanner'); // https://npmjs.org/package/portscanner

// TODO: neatly work out all errors in a structure {"code":..., "message": ...}

var APPS_LOCATION = 'objects';

/**
 * Create a proxy for a single method of an object
 * @param {String} objectName
 * @param {String} method
 * @return {Function}
 */
function createMethodProxy (objectName, method) {
    return function () {
        call(objectName, method, arguments);
    };
}

/**
 * Replace all methods of given object with a proxy
 * @param {String} objectName
 * @param {Object} object
 */
function applyProxy(objectName, object) {
    for (var method in object) {
        //if (object.hasOwnProperty(method)) {
            if (typeof(object[method]) == 'function') {
                object[method] = createMethodProxy(objectName, method);
            }
        //}
    }
}

/**
 * Remove all proxy method from an object
 * @param {String} objectName
 * @param {Object} object
 */
function removeProxy(objectName, object) {
    var proto = require(getObjectFilename(objectName)).prototype;  // TODO: is constrution needed here?

    for (var method in object) {
        //if (object.hasOwnProperty(method)) {
            if (typeof(object[method]) == 'function') {
                object[method] = proto[method];
            }
        //}
    }
}

/**
 * Retrieve the parameter names of a function
 * http://stackoverflow.com/a/9924463/1069529
 * @param {function} func
 * @return {String[]} paramNames
 */
function getParamNames(func) {
    var funStr = func.toString();
    return funStr.slice(funStr.indexOf('(')+1, funStr.indexOf(')')).match(/([^\s,]+)/g);
}

/**
 * @constructor ObjectProxy
 * Create an object proxy. Can route to a local or a remote object. The object
 * itself (or its proxy) can be retrieved via ObjectProxy.getInstance
 * @param {String} name       name of the object. Can be a composite 'name/id'
 * @param {String} [url]      url to the remote node where the object
 *                            is running. If parameter url is provided, the
 *                            parameter instance should be undefined.
 */
function ObjectProxy(name, url) {
    this.name = name;
    this.instance = undefined;
    this.isProxy = false;
    this.setUrl(url);
}

/**
 * Set or remove the url of the object proxy
 * @param {String} url     New url where the object is hosted, or undefined
 *                         if the object is no longer hosted
 */
ObjectProxy.prototype.setUrl = function (url) {
    this.url = url;
    this.isLocal = (url == undefined);

    if (this.isLocal) {
        this.getInstance();
    }

    this.updateRouting();
};

/**
 * Get a proxy for this object.
 */
ObjectProxy.prototype.updateRouting = function () {
    if (this.instance) {
        if (!this.isLocal && !this.isProxy) {
            console.log(this.name + ' apply proxy');
            applyProxy(this.name, this.instance);
            this.isProxy = true;
        }
        else if (this.isLocal && this.isProxy) {
            console.log(this.name + ' remove proxy');
            removeProxy(this.name, this.instance);
            this.isProxy = false;
        }
    }
};

/**
 * Get a proxy for this object.
 * @return {Object} proxy
 */
ObjectProxy.prototype.getInstance = function () {
    if (!this.instance) {
        // TODO: test if source code is available. if not, try to retrieve the code

        var constructor = require(getObjectFilename(this.name));
        this.instance = new constructor();
        // from an other node. If nowhere available, throw an exception.
        this.updateRouting();
    }

    return this.instance;
};

/**
 * Invoke a method of an object.
 * The object can be located locally or remote, but must be instantiated already
 * @param {String} objectName  Name of the object. Can be a composite 'name/id'
 * @param {Array} params       an array with parameters. The last
 *                             parameter must be the callback method,
 *                             which will  be called with two parameters:
 *                             err and result.
 */
function call(objectName, method, params) {
    var callback;

    try {
        // get the object
        var object = objects.get(objectName);

        if (object.isLocal) {
            // object is running locally. invoke the object
            var instance = object.getInstance();
            instance[method].apply(instance, params);
            // TODO: try/catch seems not to work, for example when you don't provide the correct number of parameters
        }
        else {
            // TODO: move this part into the method proxy?
            console.log('call ' + objectName + '.' + method + ' via proxy'); // TODO: cleanup

            // object is running remotely. send a json-rpc call
            var args = [];
            var iMax = params.length - 1;
            for (var i = 0; i < iMax; i++) {
                args.push(params[i]);
            }
            callback = params[iMax];
            var url = object.url + '/rpc/' + objectName;
            var rpcReq = {
                'method': method,
                'params': args
            };
            var options = {
                'url': url,
                'method': 'POST',
                'body': JSON.stringify(rpcReq)
            };
            request(options, function (err, res, body) {
                if (err) {
                    callback(err, null);
                }
                else {
                    var rpcRes = JSON.parse(body);
                    callback(rpcRes.error, rpcRes.result);
                }
            });
        }
    }
    catch (err) {
        callback = params[params.length - 1];
        callback(err, null);
    }
}

/**
 * Invoke a JSON-RPC request on a specified object.
 * The object may be running locally or remotely
 * @param {String} objectName        Name of the object.
 *                                   Can be a composite 'name/id'
 * @param {Object} req               A JSON-RPC request (containing method and
 *                                   params)
 * @param {function} callback        A callback method, invoked with two
 *                                   arguments: err and res, where res is a
 *                                   JSON-RPC response containing a result and
 *                                   an error.
 */
function jsonrpc(objectName, req, callback) {
    var i, iMax, res;

    // TODO: optimization. detect here if the object is remote or not. If so, directly pass it on without interpreting the request
    var method = req.method;
    var params = req.params;
    try {
        var rpcCallback = function (err, result) {
            res = {
                'id': req.id,
                'result': !err ? result : null,
                'error': err
            };
            callback(null, res);
        };

        var args = [];
        if (params instanceof Array) {
            // array (JSON-RPC 1.0)
            for (i = 0, iMax = params.length; i < iMax; i++) {
                args.push(params[i]);
            }
            args.push(rpcCallback);
        }
        else {
            // object (JSON-RPC 2.0)
            // TODO: optimize this. getParamNames is relatively slow, cache the parameter names for a next time
            var func = require(getObjectFilename(objectName)).prototype[method];
            var paramNames = getParamNames(func);
            for (i = 0, iMax = paramNames.length; i < iMax; i++) {
                var paramName = paramNames[i];
                args[i] = params[paramName];
            }
            args[paramNames.length - 1] = rpcCallback;
        }

        call(objectName, method, args);
    }
    catch (err) {
        res = {
            'id': req.id,
            'result': null,
            'error': err
        };
        callback(null, res);
    }
}

/**
 * @constructor NodeManager
 * The node manager manages the registered dapp nodes
 * @param {Number} [interval]   optional monitoring interval in milliseconds
 */
function NodeManager(interval) {
    this.nodes = [];
    this.interval = interval != undefined ? interval : 10000; // monitoring interval in ms
}

/**
 * Retrieve a list with all registered dapp nodes
 * @return {Array}
 */
NodeManager.prototype.list = function () {
    return this.nodes;
};

/**
 * Connect to a remote node
 * @param {String} url    Url of the remote node
 */
NodeManager.prototype.connect = function (url) {
    // TODO: normalize the url
    if (this.nodes.indexOf(url) == -1) {
        this.nodes.push(url);
        console.log('connected node ' + url);
        // TODO: immediately retrieve the objects running at this node
        // TODO: immediately connect this node to the other node.
    }
};

/**
 * Disconnect from a remote node
 * @param {String} url    Url of the node
 */
NodeManager.prototype.disconnect = function (url) {
    // TODO: normalize the url
    var index = this.nodes.indexOf(url);
    if (index != -1) {
        this.nodes.splice(index, 1);
        console.log('disconnected node ' + url);

        // unregister the objects that where running on this node
        objects.unregisterAll(url);
    }
};

/**
 * Scan the network for nodes, and update the object list of all connected nodes
 * @param {function} callback
 */
NodeManager.prototype.scan = function (callback) {
    var me = this;
    this.scanNodes(function(err, status) {
        me.scanObjects(callback);
    });
};

/**
 * Scan all local ports for other Distributed-App nodes, and
 * connect/disconnect them
 * @param {function} callback
 */
NodeManager.prototype.scanNodes = function (callback) {
    var unchecked = (endPort - startPort + 1);
    var start = + new Date();
    var manager = this;
    var connected = [];
    var disconnected = [];
    for (var port = startPort; port <= endPort; port++) {
        if (port != myPort) {
            var url = 'http://localhost:' + port;
            (function (url) {
                manager.isDistributedApp(url, function (err, isDapp) {
                    if (isDapp) {
                        if (manager.nodes.indexOf(url) == -1) {
                            // new node found. connect this node
                            manager.connect(url);
                            connected.push(url);
                        }
                    }
                    else {
                        if (manager.nodes.indexOf(url) != -1) {
                            // known node does not exist anymore. disconnect
                            manager.disconnect(url);
                            disconnected.push(url);
                        }
                    }

                    unchecked--;
                    if (unchecked == 0) {
                        var end = + new Date();
                        callback(null, {
                            'connected': connected,
                            'disconnected': disconnected,
                            'time': (end - start)
                        }); // TODO: what to send back?
                    }
                })
            })(url);
        }
        else {
            unchecked--;
        }
    }
};

/**
 * Update the objects of connected nodes
 * @param {function} callback
 */
NodeManager.prototype.scanObjects = function (callback) {
    var nodes = this.nodes;
    var todo = nodes.length;
    if (todo == 0) {
        callback(null);
    }
    else {
        for (var n = 0, nMax = nodes.length; n < nMax; n++) {
            var url = nodes[n];

            (function (url) {
                // retrieve the list with running objects
                // TODO: also retrieve the remote objects of the remote node?
                // TODO: simplify the method scanObjects
                request.get(url + '/objects?remote=false', function (err, res, body) {
                    var i, iMax, j, jMax, found, registeredObject;

                    if (!err) {
                        // append the retrieved objects
                        var remoteObjects = JSON.parse(body);
                        var registeredObjects = objects.findAll(url);

                        // remove known objects which are no longer in remoteObjects
                        for (i = 0, iMax = registeredObjects.length; i < iMax; i++) {
                            registeredObject = registeredObjects[i];
                            found = false;
                            for (j = 0, jMax = remoteObjects.length; j < jMax; j++) {
                                if (registeredObject.name == remoteObjects[j].name) {
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                objects.unregister(registeredObject.name, registeredObject.url)
                            }
                        }

                        // append remoteObjects which are not yet in knownObjects
                        for (j = 0, jMax = remoteObjects.length; j < jMax; j++) {
                            var remoteObject = remoteObjects[j];
                            registeredObject = objects.find(remoteObject.name);
                            if ((!registeredObject || remoteObject.url != registeredObject.url) &&
                                    remoteObject.url != myUrl) {
                                objects.register(remoteObject.name, remoteObject.url || url);
                            }
                        }
                    }
                    else {
                        // remove all current registered objects with this url
                        objects.unregisterAll(url);
                    }

                    // as soon as all nodes are visited, send the callback
                    todo--;
                    if (todo <= 0) {
                        callback(null, 'ok');
                    }
                });
            })(url);
        }
    }
};

/**
 * Check if a Distributed-App node is running at given url
 * @param {String} url
 * @param {function} callback
 */
NodeManager.prototype.isDistributedApp = function (url, callback) {
    request.get(url, function (err, res, body) {
        if (!err) {
            if (res.headers['content-type'].indexOf('application/json') == 0) {
                var json = JSON.parse(body);
                if (json.app == 'distributed-app') {
                    callback(null, true);
                    return;
                }
            }
        }
        callback(null, false);
    });
};

/**
 * Start monitoring the network for nodes, and the connected nodes for changes
 */
NodeManager.prototype.startMonitoring = function () {
    console.log('started monitoring the network for other distributed-app nodes');

    var manager = this;
    function scan () {
        // scan for other dapp nodes
        manager.scan(function (err, status) {
            if (err) {
                console.log('scanning failed: ' + err);
            }
            manager.monitorTimer = setTimeout(scan, manager.interval);
        });
    }
    scan();
};

/**
 * Stop monitoring the network and the connected nodes
 */
NodeManager.prototype.stopMonitoring = function () {
    console.log('stopped monitoring the network for other distributed-app nodes');
    if (this.monitorTimer) {
        clearTimeout(this.monitorTimer);
        delete this.monitorTimer;
    }
};

/**
 * Retrieve the filename of given object name.
 * @param {String} name       Name of the object. Can be a composite 'name/id'
 * @return {String} filename
 */
function getObjectFilename(name) {
    return './' + APPS_LOCATION + '/' + name.split('/')[0] + '.js'
}

/**
 * @constructor ObjectMananger
 */
function ObjectMananger () {
    this.objects = {}; // map with running objects
}

/**
 * Find an object instance. Returns an ObjectProxy object, which can be local
 * or remote
 * @param {String} name           Name of the object. Can be a composite 'name/id'
 * @return {ObjectProxy} object   An ObjectProxy, or undefined when not found
 */
ObjectMananger.prototype.find = function (name) {
    return this.objects[name];
};

/**
 * Find a all remote objects running on given node
 * or remote
 * @param {String} url               url of the node
 * @return {ObjectProxy[]} objects   An array with ObjectProxy, or empty array
 *                                   when none found
 */
ObjectMananger.prototype.findAll = function (url) {
    var remoteObjects = [];
    var objects = this.objects;
    for (var name in objects) {
        if (objects.hasOwnProperty(name)) {
            var object = objects[name];
            if (object.url == url) {
                remoteObjects.push(object);
            }
        }
    }
    return remoteObjects;
};

/**
 * Start an object locally.
 * @param {String} name          Name of the object. Can be a composite 'name/id'
 * @return {ObjectProxy} object  An ObjectProxy, or undefined when not found
 */
ObjectMananger.prototype.start = function (name) {
    var object = this.find(name);
    if (!object) {
        // TODO: test if source code is available. if not, try to retrieve the code
        // from an other node. If nowhere available, throw an exception.

        // start only if not already available
        object = new ObjectProxy(name, null);
        this.objects[name] = object;

        // TODO: immediately send registration to the other dapp nodes

        console.log('started object ' + name);
    }

    return object;
};

/**
 * Stop a local object
 * @param {String} name       Name of the object. Can be a composite 'name/id'
 */
ObjectMananger.prototype.stop = function (name) {
    // TODO: when calling stop, we need to know if the object is referenced locally. if so, we may not stop!
    var object = this.objects[name];
    if (object && object.isLocal) {
        delete this.objects[name];
        console.log('stopped object ' + name);
    }
    else {
        throw new Error('Cannot stop object ' + name + ':' +
            ' not found or not running locally');
    }
};

/**
 * Register a remote object
 * @param {String} name
 * @param {String} url
 */
ObjectMananger.prototype.register = function (name, url) {
    var registered = false;
    var object = this.objects[name];
    if (!object) {
        object = new ObjectProxy(name, url);
        this.objects[name] = object;
        registered = true;
    }

    // update the url (may change from local to remote)
    if (object.url != url) {
        object.setUrl(url);
        registered = true;
    }

    if (registered) {
        console.log('registered object ' + name + ' (running at ' + url + ')');
    }

    if (url) {
        // retrieve object sourcecode (if not available)
        // TODO: this should be done here, but when the code is actually needed
        this.retrieveCode(name, url);
    }
};

/**
 * Unregister a remote object
 * @param {String} name
 * @param {String} url
 */
ObjectMananger.prototype.unregister = function (name, url) {
    var object = this.objects[name];
    if(object.url == url) {
        //delete this.objects[name]; // TODO: do not delete the object but create it locally?
        this.objects[name].setUrl(undefined);

        console.log('unregistered object ' + object.name +
                    ' (running at ' + url + ')');
    }
};

/**
 * Register all objects from a remote node
 * @param {String} url
 */
ObjectMananger.prototype.unregisterAll = function (url) {
    var objects = this.objects;
    for (var name in objects) {
        if (objects.hasOwnProperty(name)) {
            this.unregister(name, url);
        }
    }
};

/**
 * Retrieve a list with objects registered by this distributed-app node.
 * This can include both local and remote objects.
 * @param {Object} options    Object with options:
 *                            - local  true|false    If true (default) the locally
 *                                                   running objects will
 *                                                   be included in response.
 *                            - remote true|false    If true (default) the remotely
 *                                                   running objects will
 *                                                   be included in response.
 * @return {Object[]} objects Array with objects, containing fields:
 *                            - {String} name
 *                            - {String} id
 *                            - {String} url
 *                            - {Boolean} local
 */
ObjectMananger.prototype.list = function (options) {
    var includeLocal = options.local != undefined ? options.local : true;
    var includeRemote = options.remote != undefined ? options.remote : true;

    var resp = [];
    var objects = this.objects;
    for (var objectName in objects) {
        if (objects.hasOwnProperty(objectName)) {
            var object = objects[objectName];
            if ((object.isLocal && includeLocal) || (!object.isLocal && includeRemote)) {
                resp.push({
                    'name': object.name,
                    'url': object.url,
                    'isLocal': object.isLocal
                });
            }
        }
    }

    return resp;
};

/**
 * Get the object object.
 * The object will be loaded if it is not yet running anywhere
 * @param {String} name            An object name. Can be a composite "name/id"
 * @return {ObjectProxy} object    The instantiated object
 */
ObjectMananger.prototype.get = function (name) {
    // TODO: create option to give the object an id (so you can create multiple instances of one object)
    // TODO: getObject should wait until the distributed app is initialized:
    //       - is listening on a port
    //       - has synchronized its running objects with others
    var object = this.find(name);
    if (!object) {
        // start the object locally if it is nowhere running
        object = this.start(name);
    }

    // return a the object
    return object;
};

/**
 * Retrieve an overview of the objects methods and their parameter names
 * @param {String} name      object name
 * @return {Object} methods
 */
ObjectMananger.prototype.getMethods = function (name) {
    var proto = require(getObjectFilename(name)).prototype;
    var methods = {};
    if (proto) {
        for (var method in proto) {
            if (proto.hasOwnProperty(method)) {
                if (typeof(proto[method]) == 'function') {
                    methods[method] = getParamNames(proto[method])
                }
            }
        }
    }
    return methods;
};

/**
 * Retrieve the source code of an object from a remote node
 * @param {String} name   Method name
 * @param {String} url    Url of the remote node
 */
ObjectMananger.prototype.retrieveCode = function (name, url) {
    if (url) {
        // if the sourcecode of the object is not available,
        // retrieve the code from the other node
        var filename = getObjectFilename(name);
        var exists = false;
        try {
            var stats = fs.lstatSync(filename);
            exists = stats.isFile();
        }
        catch (err) {}
        if (!exists) {
            console.log('sourcecode of object ' + filename + ' not available');
            request.get(url + '/objects/' + name + '/code', function (err, res, body) {
                if (!err) {
                    fs.writeFile(filename, body, function (err) {
                        if (!err) {
                            console.log('sourcecode of object ' + name + ' retrieved');
                        }
                    });
                }
                else {
                    console.log(err); // TODO: handle error
                }
            });
        }
    }
};

/**
 * Start the distributed application listening on a free port,
 * providing a RESTful API.
 */
// TODO: store start and end port in a configuration file.
var startPort = 3000;
var endPort = 3010;
var monitorInterval = 5000; // ms
var myPort = undefined;
var myUrl = undefined;
// TODO: neatly create a DistributedApp prototype

// list with local and remote objects
objects = new ObjectMananger();

// list with registered dapp nodes
var nodes = new NodeManager(monitorInterval);
nodes.startMonitoring();

portscanner.findAPortNotInUse(startPort, endPort, 'localhost', function(error, port) {
    if (error == null) {
        myPort = port;
        myUrl = 'http://localhost:' + myPort; // TODO: not so nice solution

        // initialize web app
        var app = express();

        // create method to retrieve raw request body
        // http://stackoverflow.com/a/9920700/1069529
        app.use (function(req, res, next) {
            var data='';
            req.setEncoding('utf8');
            req.on('data', function(chunk) {
                data += chunk;
            });
            req.on('end', function() {
                req.rawBody = data;
                next();
            });
        });

        // Generic information
        app.get('/', function(req, res){
            var json = {
                'app': 'distributed-app',
                'url': myUrl,
                'description': 'Distributed-App provides a framework to run Node.js applications in a distributed way.',
                'documentation': 'https://github.com/wjosdejong/distributed-app'
            };
            res.send(json);
        });

        // Nodes API
        app.get('/nodes', function (req, res) {
            res.send(nodes.list());
        });
        app.post('/nodes/connect', function (req, res) {
            var json = JSON.parse(req.rawBody);
            // TODO: throw error when url is missing
            nodes.connect(json.url);
            res.send({"status": "success", "error": null});
        });
        app.post('/nodes/disconnect', function (req, res) {
            var json = JSON.parse(req.rawBody);
            // TODO: throw error when url is missing
            nodes.disconnect(json.url);
            res.send({"status": "success", "error": null});
        });
        app.get('/nodes/scan', function (req, res) {
            nodes.scan(function (err, status) {
                if (err) {
                    res.statusCode = 500;
                    res.send(err);
                }
                else {
                    res.send(status);
                }
            });
        });

        // Objects API
        app.get('/objects', function(req, res){
            // return a list with all known objects. can be filtered by local/remote
            var options = {};
            if (req.query.local) {
                options.local = JSON.parse(req.query.local);
            }
            if (req.query.remote) {
                options.remote = JSON.parse(req.query.remote);
            }
            res.send(objects.list(options));
        });
        app.get('/objects/:object', function (req, res) {
            // return a map with all methods of the object
            res.send(objects.getMethods(req.params.object));
        });
        app.get('/objects/:object/code', function (req, res) {
            // retrieve the source code of an object
            fs.readFile(getObjectFilename(req.params.object), 'utf8', function (err, data) {
                if (err) {
                    res.statusCode = 404;
                    res.send('Object "' + req.params.object + '" not found');
                }
                else {
                    res.send(data);
                }
            });
        });
        app.post('/objects/:object/code', function (req, res) {
            // save the source code of an object
            var data = req.rawBody;
            fs.writeFile(getObjectFilename(req.params.object), data, function (err) {
                if (err) {
                    res.statusCode = 500;
                    res.send(err);
                }
                else {
                    console.log('sourcecode of object ' + req.params.object + ' retrieved');
                    res.send('Sourcecode of object "' + req.params.object + '" saved');
                }
            });
        });
        app.get('/objects/:object/start', function (req, res) {
            objects.start(req.params.object);
            res.send('started object ' + req.params.object);
        });
        app.get('/objects/:object/stop', function (req, res) {
            objects.stop(req.params.object);
            res.send('stopped object ' + req.params.object);
        });

        // JSON-RPC API
        app.post('/rpc/:object', function(req, res){
            var object = req.params.object;
            var jsonReq = JSON.parse(req.rawBody);
            jsonrpc(object, jsonReq, function (err, jsonRes) {
                res.send(jsonRes);
            });
            // TODO: test if all variables are there, if not, give error
        });
        app.post('/rpc/:object/:id', function(req, res){
            var object = req.params.object;
            var id = req.params.id;
            var jsonReq = JSON.parse(req.rawBody);
            jsonrpc(object + '/' + id, jsonReq, function (err, jsonRes) {
                res.send(jsonRes);
            });
            // TODO: test if all variables are there, if not, give error
        });

        // start listening at the found free port
        app.listen(myPort);
        console.log('distributed-app node listening at ' + myUrl);

        // TODO: neatly handle all kind of errors in the webapp, throw 404 errors, parameter missing errors, etc
    }
    else {
        console.log('error:', error);
    }
});


// exports
module.exports = {
    'getObject': function (name) {
        return objects.get(name).getInstance();
    },
    'call': call
};
