# orchestr8
The purpose of orchestr8 is to watch and deploy apps that are stored as npm packages.

The apps must be binary launchable (package.json: "bin" pointed to a js file), and, once running,
must respond to pings on `/test` to verify that the apps are awake and healthy

If a version responds to enough pings it'll be marked as "stable".

orchestr8 is loaded with a config.yml file that tells it how the things it's going to deploy
are going to be deployed.


### notes:
this communicates with docker a lot using /var/run/docker.sock, which doesn't work on Windows
because Windows doesn't _have_ that file, or, in fact, support UNIX sockets at all.
Get out the Mac laptop or use codespaces or something?

## Install

### Basics
* Docker, node (v.20)

### Prep
* `npm install -g knex`
* `npm install -g jake`
* `npm install -g nodemon`
* `docker pull node:20`
* `docker pull nginx:alpine`
* `docker network create orchestr8`

### Hosts

For the sake of testing that this system successfully serves the correct content
to the correct hostnames, we point groovelet.local to 127.0.0.1

* Add `groovelet.local 127.0.0.1` to your /etc/hosts
* `c:\windows\system32\drivers\etc\hosts` on windows
