docker build -t my-angular-app .
docker run -p 8080:80 my-angular-app


docker build -t my-graphql-app .
docker stop my-graphql
docker run --rm --detach -p 7082:4000 --name my-graphql my-graphql-app
