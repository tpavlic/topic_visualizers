# Reference values for test/design.test.mjs: R's model.matrix on a small
# table with a continuous, a categorical, and an ordinal predictor, a raw
# power, an interaction, and an aliased column. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/design.R > glmm_analyzer/test/reference/design.json
d <- data.frame(
  y = c(1.2, 0.8, 2.5, 3.1, 0.4, 1.9, 2.2, 2.8, 1.0, 1.5),
  x = c(0.5, 1.5, 2.0, 3.5, 0.2, 2.8, 1.1, 3.9, 0.9, 2.3),
  f = factor(c("a", "b", "c", "a", "b", "c", "a", "b", "c", "a")),
  o = factor(c("low", "mid", "high", "high", "low", "mid", "low", "high", "mid", "low"), levels = c("low", "mid", "high"), ordered = TRUE),
  g = factor(c("10", "2", "1", "10", "2", "1", "10", "2", "1", "10"))
)
# A column that is the sum of two others, to be aliased.
d$z <- d$x + 1
m1 <- model.matrix(~ x + f + o + I(x^2) + x:f, d)
m2 <- model.matrix(~ g, d)
m3 <- model.matrix(~ x + z, d)
m4 <- model.matrix(~ f:o + f + o, d)
cat(jsonlite::toJSON(list(
  m1 = list(names = colnames(m1), rows = unname(as.matrix(m1))),
  m2 = list(names = colnames(m2), rows = unname(as.matrix(m2))),
  m3 = list(names = colnames(m3), rows = unname(as.matrix(m3))),
  m4 = list(names = colnames(m4), rows = unname(as.matrix(m4))),
  poly4 = unname(contr.poly(4)), poly5 = unname(contr.poly(5))
), digits = 15, auto_unbox = TRUE))
