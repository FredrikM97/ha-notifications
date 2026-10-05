# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/devcontainers/python:3

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg libturbojpeg0 \
	&& rm -rf /var/lib/apt/lists/*
