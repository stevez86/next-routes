import pathToRegexp from 'path-to-regexp'
import React from 'react'
import {parse} from 'url'
import NextLink from 'next/link'
import NextRouter from 'next/router'

module.exports = opts => new Routes(opts)

class Routes {
  constructor ({
    Link = NextLink,
    Router = NextRouter
  } = {}) {
    this.routes = []
    this.Link = this.getLink(Link)
    this.Router = this.getRouter(Router)
  }

  add (name, pattern, page, data) {
    let options
    if (name instanceof Object) {
      options = name
      name = options.name
    } else {
      if (name[0] === '/') {
        data = page
        page = pattern
        pattern = name
        name = null
      }
      options = {name, pattern, page, data}
    }

    if (this.findByName(name)) {
      throw new Error(`Route "${name}" already exists`)
    }

    this.routes.push(new Route(options))
    return this
  }

  findByName (name) {
    if (name) {
      return this.routes.find(route => route.name === name)
    }
  }

  match (url) {
    const parsedUrl = parse(url, true)
    const {pathname, query} = parsedUrl

    let params
    const route = this.routes.find(route => {
      params = route.match(pathname)
      return params
    })

    return { parsedUrl, route, params, query: { ...query, ...(params || {}) } }
  }

  findAndGetUrls (nameOrUrl, params) {
    const route = this.findByName(nameOrUrl)

    if (route) {
      return {route, urls: route.getUrls(params), byName: true}
    } else {
      const {route, query} = this.match(nameOrUrl)
      const href = route ? route.getHref(query) : nameOrUrl
      const urls = {href, as: nameOrUrl}
      return {route, urls}
    }
  }

  getRequestHandler (app, customHandler) {
    const nextHandler = app.getRequestHandler()

    return (req, res) => {
      const {route, query, parsedUrl, params} = this.match(req.url)

      if (route) {
        if (customHandler) {
          customHandler({req, res, route, query})
        } else {
          const {name, data} = route
          app.render(req, res, route.getPage({params, name, data}), query)
        }
      } else {
        nextHandler(req, res, parsedUrl)
      }
    }
  }

  getLink (Link) {
    const LinkRoutes = props => {
      const {route, params, to, ...newProps} = props
      const nameOrUrl = route || to

      if (nameOrUrl) {
        Object.assign(newProps, this.findAndGetUrls(nameOrUrl, params).urls)
      }

      return <Link {...newProps} />
    }
    return LinkRoutes
  }

  getRouter (Router) {
    const wrap = method => (route, params, options) => {
      const {byName, urls: {as, href}} = this.findAndGetUrls(route, params)
      return Router[method](href, as, byName ? options : params)
    }

    Router.pushRoute = wrap('push')
    Router.replaceRoute = wrap('replace')
    Router.prefetchRoute = wrap('prefetch')
    return Router
  }
}

class Route {
  constructor ({name, pattern, page = name, data}) {
    if (!name) {
      throw new Error(`Missing name to render for route "${pattern}"`)
    }

    this.name = name
    this.data = data
    this.pattern = pattern || `/${name}`
    this.getPage = createGetPage(page)
    this.regex = pathToRegexp(this.pattern, this.keys = [])
    this.toPath = pathToRegexp.compile(this.pattern)
  }

  match (path) {
    const values = this.regex.exec(path)
    if (values) {
      return this.valuesToParams(values.slice(1))
    }
  }

  valuesToParams (values) {
    return values.reduce((params, val, i) => {
      if (val === undefined) return params
      return Object.assign(params, {
        [this.keys[i].name]: decodeURIComponent(val)
      })
    }, {})
  }

  getHref (params = {}) {
    return `${this.getPage({ name: this.name, data: this.data, params })}?${toQuerystring(params)}`
  }

  getAs (params = {}) {
    const as = this.toPath(params) || '/'

    const qsParams = {}
    let hasQs = false
    this.keys.forEach(({ name }) => {
      if (params[name]) {
        qsParams[name] = params[name]
        hasQs = true
      }
    })

    if (!hasQs) return as
    return `${as}?${toQuerystring(qsParams)}`
  }

  getUrls (params) {
    const as = this.getAs(params)
    const href = this.getHref(params)
    return {as, href}
  }
}

const toQuerystring = obj => Object.keys(obj)
  .filter(key => obj[key] !== null && obj[key] !== undefined)
  .map(key => {
    let value = obj[key]

    if (Array.isArray(value)) {
      value = value.join('/')
    }
    return [
      encodeURIComponent(key),
      encodeURIComponent(value)
    ].join('=')
  }).join('&')

const cleanPage = page => page.replace(/(^|\/)index$/, '').replace(/^\/?/, '/')

const createGetPage = page => {
  if (typeof page === 'string') {
    if (page[0] === '/') {
      const toPath = pathToRegexp.compile(page)
      return ({ params }) => toPath(params)
    }
    const cleanedPage = cleanPage(page)
    return () => cleanedPage
  }
  if (typeof page !== 'function') {
    throw new Error(`Page must be a string or a function, got ${typeof page}`)
  }
  return page
}