Distributed-App
===============


## Introduction

Distributed-App provides a framework to run Node.js applications in a
distributed way. Multiple Distributed-App nodes can form a peer-2-peer
network, on which the application nodes can be spread. The nodes take care
of load-balancing, migration, auto repair, and fault tolerance for the
running objects of an application.

Application objects are created via the Distributed-App framework, and
accessed as if they are locally available. The Distributed-App can run the
objects locally or move them dynamically to a remote node. Local objects can be
directly accessed natively, with no overhead at all, while remote objects are
accessed via a proxy, which routes the requests to the node where the object is
actually running.


## Getting Started

To start a new Distributed-App node, enter the following on a command line:

    node distributed-app.js

The node will start listening on a free port, starting at port 3000.

    distributed-app node listening at http://localhost:3000

The node will start without having any objects running. Objects (for example
the calculator) can be started or stopped manually via the RESTful interface:

    HTTP GET http://localhost:3000/objects/calculator/start
    HTTP GET http://localhost:3000/objects/calculator/stop

An objects methods can be accessed via the rpc interface:

    HTTP POST http://localhost:3000/rpc/calculator/
    {
        "method": "add",
        "params": [2.2, 5.6]
    }

When a second node is started, it will automatically search for other nodes,
and register the objects that are already running on the other nodes. When the
calculator object is addressed from this second node, it will redirect and
process the request on the first node where the calculator object is actually
running.


## RESTful API

### Generic

#### GET /

Get generic information about this distributed-app node.


### Nodes

#### GET /nodes

Get a list with the urls of all registered nodes.

#### POST /nodes/connect

body: {'url': url}

Connect to an other node.

#### POST /nodes/disconnect

body: {'url': url}

Disconnect from an other node.


### Objects

#### GET /objects

Get a list with all objects that the distributed-app node knows. The
returned objects can be filtered by locally running and remotely running
objects. By default, the request returns both local and remote objects.

The response is an array with parameters of the running objects, containing
the following parameters:

- {String} name
- {String} id
- {String} url
- {Boolean} local

Query parameters:

- local  true|false    If true (default) the locally running objects will
                       be included in response.
- remote true|false    If true (default) the remotely running objects will
                       be included in response.

#### GET /objects/:object/code

Get the source code of an object. If the object or source is not available,
a 404 not found error is returned.

#### POST /objects/:object/code

Post source code for an object.

#### GET /objects/:object/start

#### GET /objects/:object/stop


### RPC requests

#### POST /rpc/:object

body: JSON-RPC 1.0 or 2.0 request, {"id": ..., "method": ..., "params": [...]}

Invoke a method on the default instance of an object.

#### POST /rpc/:object/:id

body: JSON-RPC 1.0 or 2.0 request, {"id": ..., "method": ..., "params": [...]}

Invoke a method on the instance of an object with specified id.
