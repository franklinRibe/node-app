# Infrastructure about this application

This is the briefly explanation about the process that I used to create this Infrastructure for this APP.

* 1 - First of all I received just a repo that had a simple node app that start an  API to reply some requisitions.

So, the first thing that I did was created the dockerfile to containerized the application.

```
   FROM node:8 as builder
   
   WORKDIR /app
   
   COPY package*.json ./
   RUN npm install
   
   COPY . .
   
   FROM node:8
   WORKDIR /app
   
   COPY --from=builder /app ./
   
   EXPOSE 3000
   CMD ["npm", "start"]

```

It's do quite simple, first I used the node:8 image as based to build this image, after I copied all of packages to inside the image and after that I prefered to use a multi-stage build approach, because this is a best practice that decrease the size of final image.

And after that I exposed the port that the app will listen on.

* 2 - With the image created I started to develop kubernetes manifests to deploy it on a cluster.
Fisrt, I decided use the kustomize to configure the manifests, cause it can be reused the code to deploy it in a bunch of environments.

I created the follow folder structure:

```bash
├── base
│   ├── app-deployment.yaml
│   ├── app-service.yaml
│   └── kustomization.yaml
└── envs
    ├── prod
    │   ├── ingress.yaml
    │   ├── kustomization.yaml
    │   ├── namespace.yaml
    │   └── patch.yaml
    ├── qa
    │   ├── ingress.yaml
    │   ├── kustomization.yaml
    │   ├── namespace.yaml
    │   └── patch.yaml
    └── staging
        ├── ingress.yaml
        ├── kustomization.yaml
        ├── namespace.yaml
        └── patch.yaml

```

* 2.1 - In base folder, it contains the manifests that is common to all of environments, in this case the deployment object, the service and the kustomization file that is mandatory.

* 2.2 - In envs folder, it contains the manifests that is just used by the specific environment, like namespaces and ingresses.

* 2.3 - The special thing about the envs folder is the **"patch"** file. This file use one feature of the kustomize that allows overwrite some items inside of another manifest. 

For example, in this specific case I used to overwrite the **replicas** item in the deployment object to increase the value from **1** to **5** in production environment.

I also increased the **request** and **limits** in that pod, in case of production, this process creates the two differents deployments, one "common" and other specially, see both:

**COMMON**
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-app
  labels:
    app: node-app
spec:
  selector:
    matchLabels:
      app: node-app
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
    type: RollingUpdate
  replicas: 1
  template:
    metadata:
      labels:
        app: node-app
    spec:
      containers:
      - name: node-app
        image: franklinribe/node-app
        resources:
          requests:
            cpu: 100m
            memory: 100Mi
          limits:
            cpu: 200m
            memory: 200Mi
        ports:
        - containerPort: 3000
```

**PRODUCTION**

``` 
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: node-app
  name: node-app
  namespace: production
spec:
  replicas: 5
  selector:
    matchLabels:
      app: node-app
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: node-app
    spec:
      containers:
      - image: franklinribe/node-app:1.0
        name: node-app
        ports:
        - containerPort: 3000
        resources:
          limits:
            cpu: 500m
            memory: 500Mi
          requests:
            cpu: 300m
            memory: 300Mi
```

* 2.4 - Another advantage to use kustomize is the possibility to apply all manifests of one app in the same time, with just one command:
``` 
kustomize build k8s/envs/prod | kubectl -f 
```

All this configurations is good to possibility a Horizontal Scaling, because allows to increase the CPU and memory resources and limits to each environments.

This allows also to controls the **strategy** to rollout for each environments

* 3 - After to create the manifests I created a Pipeline on Gitlab to automate this process. You can find the **.gitlab-ci.yaml** in the root, I will comment it the first part bellow:

```yaml
stages:
  - build
  - deploy

variables:
  APP_IMAGE: franklinribe/node-app
  PROD_VERSION: "1.0"

build:
  tags:
    - kubernetes
  stage: build
  image: docker:latest
  services:
    - docker:dind
  before_script:
    - echo "$DOCKER_PASS" | docker login --username $DOCKER_USER --password-stdin

```

* 3.1 - First I created the stages that the pipeline it will do **build** and **deploy**, after this I setted two variables to use after to save the repo and image names.

* 3.2 - In the **build** stage, I use a tag called **kubernetes** this Tag is used to choose which the gitlab-runner the pipelines it will run.

* 3.3 - I choose the docker image to runs the pipeline and the service called **docker:dind** because I need this feature to build docker inside the docker.

* 3.4 - After all of this, I log in the docker-hub repository using the **$DOCKER_PASS** and **$DOCKER_USER**, this two variables was setted in Gitlab Web interface because is a sensitive values.

I will comment the second part bellow:

```yaml
  script:
    - cd mock-endpoints/
    - docker build --cache-from $APP_IMAGE:latest -t $APP_IMAGE:$CI_COMMIT_SHA -t $APP_IMAGE:latest -t $APP_IMAGE:$PROD_VERSION -f Dockerfile .
    - docker push $APP_IMAGE:latest
    - docker push $APP_IMAGE:$CI_COMMIT_SHA
    - docker push $APP_IMAGE:$PROD_VERSION

 .deploy_default: &deploy_default
    - apt-get update && apt-get install -y apt-transport-https ca-certificates curl
    - curl -fsSLo /usr/share/keyrings/kubernetes-archive-keyring.gpg https://packages.cloud.google.com/apt/doc/apt-key.gpg
    - echo "deb [signed-by=/usr/share/keyrings/kubernetes-archive-keyring.gpg] https://apt.kubernetes.io/ kubernetes-xenial main" | tee /etc/apt/sources.list.d/kubernetes.list
    - apt-get update && apt-get install -y kubectl
    - curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh"  | bash
    - mv kustomize /usr/bin
    - kustomize build k8s/envs/$ENV | kubectl apply -f -
```


* 3.5 - After this the pipeline enter in the app folder to runs the docker build and add three tags, the first one is the latest, the second one is the sha of the CI commit that is important in case of the rollback a version, and finally a prod version of the image that it catch of the **PROD_VERSION** variable.

* 3.6 - And finally, pipeline push theses images to the docker-hub repository.

* 3.7 - The next step is build this image inside the cluster, for this I need the two tools installed, kubectl and kustomize, and this is did in the **.deploy_default** step. This is a special step cause it will imported into the all of the deploy steps, and I don't need to execute the commands repeatedly. 

* 3.8 - If you look in the penultimate line, you will see that the pipeline moves kustomize to the PATH for use in the last line the kustomize command. The kustomize command in turn, uses the $ENV variable to know which environment that it will need apply the manifests, and this variable comes from the next steps that deploy it in each environment.

```yaml

deploy:staging:
  tags:
    - default
  variables:
    APP_URL: node-app.staging.techchurch.com.br
    ENV: staging
  stage: deploy
  image: ubuntu:latest
  environment:
    name: staging
    url: https://${APP_URL}
  script:
    - *deploy_default
  allow_failure: false
  needs:
    - build
  rules:
    - if: '$CI_COMMIT_REF_NAME == "master"'
      when: manual
```

* 3.9 - Now the next step call the **.deploy_default** to deploy the app, but uses some variables like **ENV** and **APP_URL** to deploy in the respective environment. This step is equal to others, with the different environments.

The Production and Staging step are manual, but the **QA** is deployed automatically every time that the pipelines runs.

And these are the result of each stage:

## **BUILD**

```bash

$ echo "$DOCKER_PASS" | docker login --username $DOCKER_USER --password-stdin
 WARNING! Your password will be stored unencrypted in /root/.docker/config.json.
 Configure a credential helper to remove this warning. See
 https://docs.docker.com/engine/reference/commandline/login/#credentials-store
 Login Succeeded
 $ cd mock-endpoints/
 $ docker build --cache-from $APP_IMAGE:latest -t $APP_IMAGE:$CI_COMMIT_SHA -t $APP_IMAGE:latest -t $APP_IMAGE:$PROD_VERSION -f Dockerfile .
 Step 1/10 : FROM node:8 as builder
  ---> 8eeadf3757f4
 Step 2/10 : WORKDIR /app
  ---> Using cache
  ---> 90c61c3c422b
 Step 3/10 : COPY package*.json ./
  ---> 9d0992ac6a7d
 Step 4/10 : RUN npm install
  ---> Running in 17b6981a3a98
 added 92 packages from 112 contributors and audited 93 packages in 1.988s
 found 12 vulnerabilities (6 moderate, 4 high, 2 critical)
   run `npm audit fix` to fix them, or `npm audit` for details
 Removing intermediate container 17b6981a3a98
  ---> a2fa368b317a
 Step 5/10 : COPY . .
  ---> b916621c4330
 Step 6/10 : FROM node:8
  ---> 8eeadf3757f4
 Step 7/10 : WORKDIR /app
  ---> Using cache
  ---> 90c61c3c422b
 Step 8/10 : COPY --from=builder /app ./
  ---> Using cache
  ---> b04b0fafe404
 Step 9/10 : EXPOSE 3000
  ---> Using cache
  ---> 61ff2b9bd43c
 Step 10/10 : CMD ["npm", "start"]
  ---> Using cache
  ---> b2eda2f3dd43
 Successfully built b2eda2f3dd43
 Successfully tagged franklinribe/node-app:5227933ae9f3d72926f1c3cc46cd3da0e141510a
 Successfully tagged franklinribe/node-app:latest
 Successfully tagged franklinribe/node-app:1.0
 $ docker push $APP_IMAGE:latest
 The push refers to repository [docker.io/franklinribe/node-app]
 8dea31eb9dc5: Preparing
 662c14cc2a57: Preparing
 423451ed44f2: Preparing
 b2aaf85d6633: Preparing
 88601a85ce11: Preparing
 42f9c2f9c08e: Preparing
 99e8bd3efaaf: Preparing
 bee1e39d7c3a: Preparing
 1f59a4b2e206: Preparing
 0ca7f54856c0: Preparing
 ebb9ae013834: Preparing
 42f9c2f9c08e: Waiting
 99e8bd3efaaf: Waiting
 bee1e39d7c3a: Waiting
 1f59a4b2e206: Waiting
 ebb9ae013834: Waiting
 0ca7f54856c0: Waiting
 8dea31eb9dc5: Layer already exists
 88601a85ce11: Layer already exists
 b2aaf85d6633: Layer already exists
 662c14cc2a57: Layer already exists
 423451ed44f2: Layer already exists
 99e8bd3efaaf: Layer already exists
 bee1e39d7c3a: Layer already exists
 0ca7f54856c0: Layer already exists
 1f59a4b2e206: Layer already exists
 42f9c2f9c08e: Layer already exists
 ebb9ae013834: Layer already exists
 latest: digest: sha256:80597e690de9eac2972fc010d7943a2cb879ebefffd36bbfe033c556364497bd size: 2632
```

## **DEPLOY**

```bash
 kustomize installed to /builds/devops/node-app/kustomize
 $ mv kustomize /usr/bin
 $ kustomize build k8s/envs/$ENV | kubectl apply -f -
  namespace/production created
 service/app-node created
 deployment.apps/node-app created
 ingress.networking.k8s.io/prod-app-node created

```