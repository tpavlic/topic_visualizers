# Reference values for test/variance.test.mjs: insight::get_variance and
# performance's r2_nakagawa and icc on the mixed models of mixed.R (fitted
# to the data mixed.json carries), and the same decomposition written out by
# hand for the models with no random part. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/variance.R > glmm_analyzer/test/reference/variance.json
suppressPackageStartupMessages({ library(lme4); library(glmmTMB); library(insight); library(performance) })
here <- dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE)[1]))
D <- jsonlite::fromJSON(file.path(here, "mixed.json"))$data
d <- data.frame(g = factor(D$g), h = factor(D$h), x = D$x, f = factor(D$f), ycount = D$ycount, ybin = D$ybin, ynorm = D$ynorm, yover = D$yover, ynb = D$ynb, ybeta = D$ybeta, ygam = D$ygam)
d$obs <- factor(seq_len(nrow(d)))

# A piece insight or performance declines to compute (the observation-level
# case, whose group variance sits at 0) is NA, and the test skips it.
pick <- function(x, name) { v <- if (is.list(x) || is.data.frame(x)) x[[name]] else NULL; if (is.null(v) || length(v) == 0) NA else unname(v) }
mixed_parts <- function(m) {
  v <- suppressWarnings(get_variance(m))
  r2 <- suppressWarnings(r2_nakagawa(m))
  ic <- suppressWarnings(icc(m))
  list(fixed = pick(v, "var.fixed"), random = pick(v, "var.random"), residual = pick(v, "var.residual"),
       distribution = pick(v, "var.distribution"), dispersion = pick(v, "var.dispersion"),
       r2m = pick(r2, "R2_marginal"), r2c = pick(r2, "R2_conditional"), icc = pick(ic, "ICC_adjusted"), icc_unadj = pick(ic, "ICC_unadjusted"))
}
# A model with no random part: the same pieces by hand, the mean of the
# intercept-only model standing where the null mixed model's would.
glm_parts <- function(m, family, null, theta = NA, phi = NA) {
  eta <- if (inherits(m, "betareg")) predict(m, type = "link") else predict(m, type = "link")
  vf <- var(as.vector(eta))
  b0 <- unname(if (inherits(null, "betareg")) coef(null, model = "mean")[1] else coef(null)[1])
  vd <- switch(family,
    normal = summary(m)$dispersion,
    binomial = pi^2 / 3,
    poisson = log1p(1 / exp(b0)),
    negbin = log1p(1 / exp(b0) + 1 / theta),
    gamma = log1p(summary(m)$dispersion),
    beta = { mu <- plogis(b0); log1p((mu * (1 - mu) / (1 + phi)) / mu^2) })
  list(fixed = vf, distribution = vd, residual = vd, r2 = vf / (vf + vd))
}

pois <- glmer(ycount ~ x + f + (1 | g), data = d, family = poisson)
bin <- glmer(ybin ~ x + (1 + x | g), data = d, family = binomial)
lmm_ml <- lmer(ynorm ~ x + f + (1 | g), data = d, REML = FALSE)
lmm_reml <- lmer(ynorm ~ x + f + (1 | g), data = d, REML = TRUE)
nested <- lmer(ynorm ~ x + (1 | g) + (1 | g:h), data = d, REML = FALSE)
olre_g <- glmer(yover ~ x + (1 | g) + (1 | obs), data = d, family = poisson)
nb <- glmer.nb(ynb ~ x + (1 | g), data = d)
gam <- glmer(ygam ~ x + (1 | g), data = d, family = Gamma(link = "log"))
tmb <- glmmTMB(ybeta ~ x + (1 | g), data = d, family = beta_family())

g_pois <- glm(ycount ~ x + f, data = d, family = poisson, control = glm.control(epsilon = 1e-12, maxit = 100))
g_norm <- glm(ynorm ~ x + f, data = d, family = gaussian, control = glm.control(epsilon = 1e-12, maxit = 100))
g_bin <- glm(ybin ~ x, data = d, family = binomial, control = glm.control(epsilon = 1e-12, maxit = 100))
g_nb <- MASS::glm.nb(ynb ~ x, data = d, control = glm.control(maxit = 100))
g_gam <- glm(ygam ~ x, data = d, family = Gamma(link = "log"), control = glm.control(epsilon = 1e-12, maxit = 100))
g_beta <- betareg::betareg(ybeta ~ x, data = d)

out <- list(
  pois = mixed_parts(pois), bin = mixed_parts(bin), lmm_ml = mixed_parts(lmm_ml), lmm_reml = mixed_parts(lmm_reml),
  nested = mixed_parts(nested), olre_g = mixed_parts(olre_g), nb = mixed_parts(nb), gam = mixed_parts(gam), tmb = mixed_parts(tmb),
  g_pois = glm_parts(g_pois, "poisson", update(g_pois, . ~ 1)),
  g_norm = glm_parts(g_norm, "normal", update(g_norm, . ~ 1)),
  g_bin = glm_parts(g_bin, "binomial", update(g_bin, . ~ 1)),
  g_nb = glm_parts(g_nb, "negbin", MASS::glm.nb(ynb ~ 1, data = d), theta = g_nb$theta),
  g_gam = glm_parts(g_gam, "gamma", update(g_gam, . ~ 1)),
  g_beta = glm_parts(g_beta, "beta", betareg::betareg(ybeta ~ 1, data = d), phi = unname(coef(g_beta, model = "precision")))
)
cat(jsonlite::toJSON(out, digits = 15, auto_unbox = TRUE))
