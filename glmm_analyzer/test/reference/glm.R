# Reference values for test/glm.test.mjs and test/families.test.mjs: glm on
# every family and link the GLMM Analyzer fits by IRLS, on small seeded
# datasets, with the summary quantities the page shows. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/glm.R > glmm_analyzer/test/reference/glm.json
set.seed(20261010)
n <- 60
x <- round(runif(n, 0, 3), 3)
f <- factor(sample(c("a", "b", "c"), n, replace = TRUE))
eta <- -0.5 + 0.6 * x + c(a = 0, b = 0.4, c = -0.3)[as.character(f)]
d <- data.frame(x = x, f = f)
d$ynorm <- round(2 + 1.5 * x + c(a = 0, b = 1, c = -1)[as.character(f)] + rnorm(n, 0, 0.8), 4)
d$ybin <- rbinom(n, 1, plogis(eta))
d$ycount <- rpois(n, exp(eta))
d$ypos <- round(rgamma(n, shape = 3, scale = exp(eta) / 3), 4)
d$ylog <- round(exp(1 + 0.3 * x + rnorm(n, 0, 0.3)), 4)

fit_one <- function(fml, family) {
  m <- glm(fml, family = family, data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
  s <- summary(m)
  list(
    coef = unname(coef(m)), names = names(coef(m)), se = unname(s$coefficients[, 2]),
    deviance = deviance(m), null_deviance = m$null.deviance, loglik = as.numeric(logLik(m)), df = attr(logLik(m), "df"),
    aic = AIC(m), bic = BIC(m), dispersion = s$dispersion, iter = m$iter, converged = m$converged,
    fitted = unname(fitted(m)), hat = unname(hatvalues(m)), cooks = unname(cooks.distance(m)),
    pearson = unname(residuals(m, "pearson")), devres = unname(residuals(m, "deviance")),
    ci_lo = unname(confint.default(m)[, 1]), ci_hi = unname(confint.default(m)[, 2]),
    vcov = unname(vcov(m))
  )
}
out <- list(
  data = as.list(d),
  normal_identity = fit_one(ynorm ~ x + f, gaussian()),
  normal_log = fit_one(ylog ~ x + f, gaussian(link = "log")),
  binomial_logit = fit_one(ybin ~ x + f, binomial()),
  binomial_probit = fit_one(ybin ~ x + f, binomial(link = "probit")),
  binomial_cloglog = fit_one(ybin ~ x + f, binomial(link = "cloglog")),
  poisson_log = fit_one(ycount ~ x + f, poisson()),
  poisson_sqrt = fit_one(ycount ~ x + f, poisson(link = "sqrt")),
  gamma_log = fit_one(ypos ~ x + f, Gamma(link = "log")),
  gamma_inverse = fit_one(ypos ~ x + f, Gamma(link = "inverse")),
  interaction = fit_one(ycount ~ x * f, poisson()),
  poly = fit_one(ynorm ~ x + I(x^2), gaussian()),
  intercept_only = fit_one(ybin ~ 1, binomial())
)
# Family pieces on a short vector, for the families test.
y <- c(0, 1, 2, 5, 3); mu <- c(0.5, 1.2, 2.5, 4.0, 2.0)
out$pieces <- list(
  y = y, mu = mu,
  poisson_dev = poisson()$dev.resids(y, mu, rep(1, 5)),
  poisson_ll = sum(dpois(y, mu, log = TRUE)),
  gamma_dev = Gamma()$dev.resids(y + 0.5, mu, rep(1, 5)),
  binom_dev = binomial()$dev.resids(c(0, 1, 1, 0, 1), c(0.2, 0.7, 0.9, 0.4, 0.5), rep(1, 5)),
  binom_ll = sum(dbinom(c(0, 1, 1, 0, 1), 1, c(0.2, 0.7, 0.9, 0.4, 0.5), log = TRUE)),
  negbin_ll = sum(dnbinom(y, size = 1.7, mu = mu, log = TRUE)),
  negbin_dev = MASS::negative.binomial(1.7)$dev.resids(y, mu, rep(1, 5)),
  negbin_cdf = pnbinom(y, size = 1.7, mu = mu),
  poisson_cdf = ppois(y, mu),
  gamma_cdf = pgamma(y + 0.5, shape = 1 / 0.4, scale = mu * 0.4),
  beta_ll = sum(dbeta(c(0.2, 0.5, 0.7, 0.9, 0.3), c(0.3, 0.5, 0.6, 0.8, 0.4) * 5, (1 - c(0.3, 0.5, 0.6, 0.8, 0.4)) * 5, log = TRUE)),
  beta_cdf = pbeta(c(0.2, 0.5, 0.7, 0.9, 0.3), c(0.3, 0.5, 0.6, 0.8, 0.4) * 5, (1 - c(0.3, 0.5, 0.6, 0.8, 0.4)) * 5),
  cloglog_inv = binomial(link = "cloglog")$linkinv(c(-2, 0, 1.5)),
  cloglog_mu_eta = binomial(link = "cloglog")$mu.eta(c(-2, 0, 1.5)),
  probit_mu_eta = binomial(link = "probit")$mu.eta(c(-2, 0, 1.5))
)
cat(jsonlite::toJSON(out, digits = 15, auto_unbox = TRUE))
