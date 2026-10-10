# Reference values for test/inference.test.mjs: drop1's likelihood-ratio
# table, predict.glm with standard errors, and emmeans with Tukey pairs, on
# the datasets reference/glm.R draws. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/inference.R > glmm_analyzer/test/reference/inference.json
suppressPackageStartupMessages(library(emmeans))
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
d$g <- factor(rep(c("u", "v"), length.out = n))

drop_tab <- function(m) {
  t <- drop1(m, test = "Chisq")
  t <- t[-1, ]
  list(terms = rownames(t), df = t$Df, stat = t[[4]], p = t[["Pr(>Chi)"]])
}
pred <- function(m, nd) {
  p <- predict(m, newdata = nd, type = "link", se.fit = TRUE)
  list(eta = unname(p$fit), se = unname(p$se.fit), fit = unname(predict(m, newdata = nd, type = "response")))
}
emm <- function(m, spec, lvl = 0.95) {
  e <- emmeans(m, spec, level = lvl)
  s <- as.data.frame(summary(e, type = "link"))
  r <- as.data.frame(summary(e, type = "response"))
  pr <- as.data.frame(summary(pairs(e), infer = c(TRUE, TRUE), level = lvl))
  list(levels = as.character(s[[1]]), eta = s$emmean, se = s$SE, lo = s[[5]], hi = s[[6]], df = s$df[1],
       fit = r[[2]], fit_lo = r[[5]], fit_hi = r[[6]],
       pairs = as.character(pr$contrast), diff = pr$estimate, pair_se = pr$SE, lo_p = pr[[5]], hi_p = pr[[6]], t = pr[[7]], p = pr[[8]])
}
nd <- data.frame(x = c(0.5, 1.5, 2.5, 1.0), f = factor(c("a", "b", "c", "a"), levels = c("a", "b", "c")), g = factor(c("u", "u", "v", "v")))
m_norm <- glm(ynorm ~ x + f + g, family = gaussian(), data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
m_bin <- glm(ybin ~ x + f + g, family = binomial(), data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
m_pois <- glm(ycount ~ x * f, family = poisson(), data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
m_gam <- glm(ypos ~ x + f, family = Gamma(link = "log"), data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
# The negative binomial on the data of negbin.R, where theta.ml converges.
set.seed(20261011)
nb_n <- 80
nb <- data.frame(x = round(runif(nb_n, 0, 2), 3), f = factor(sample(c("p", "q"), nb_n, replace = TRUE)))
nb$y <- rnbinom(nb_n, size = 1.8, mu = exp(0.4 + 0.7 * nb$x + ifelse(nb$f == "q", -0.5, 0)))
m_nb <- MASS::glm.nb(y ~ x + f, data = nb)
m_poly <- glm(ynorm ~ x + I(x^2) + f, family = gaussian(), data = d, control = glm.control(epsilon = 1e-12, maxit = 100))
out <- list(
  drop_norm = drop_tab(m_norm), drop_bin = drop_tab(m_bin), drop_pois = drop_tab(m_pois), drop_gam = drop_tab(m_gam), drop_nb = drop_tab(m_nb),
  pred_norm = pred(m_norm, nd), pred_bin = pred(m_bin, nd), pred_pois = pred(m_pois, nd), pred_gam = pred(m_gam, nd),
  emm_norm_f = emm(m_norm, "f"), emm_bin_f = emm(m_bin, "f", 0.90), emm_pois_f = emm(m_pois, "f"), emm_gam_f = emm(m_gam, "f"),
  emm_norm_g = emm(m_norm, "g"), emm_poly_f = emm(m_poly, "f"),
  grid_mean_x = mean(d$x), g = as.character(d$g)
)
cat(jsonlite::toJSON(out, digits = 15, auto_unbox = TRUE))
